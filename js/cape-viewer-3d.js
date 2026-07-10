/* =====================================================================
   Cape 3D viewer — refactored from the original standalone cape tool.
   No hardcoded element IDs: the host page passes its own DOM elements in,
   so this file can be dropped into any layout unchanged.

   Public API: window.CapeViewer3D.init({ wrapEl, loadingEl })
     -> { setCapeFrames(canvasArray), setPlaying(bool), setFrameDelay(ms),
          setSkinFromImage(imgEl), resetSkinToDefault() }
   ===================================================================== */

(function () {
  function init({ wrapEl, loadingEl }) {
    let renderer, scene, camera, controls;
    let capeMesh = null, bodyMeshes = [];
    let capeFrames = [];
    let capeFrameIdx = 0;
    let capeTexture = null;
    let skinTexture = null;
    let playing = true;
    let frameDelay = 100;
    let lastFrameTime = 0;
    let ready = false;

    function initThree() {
      const w = wrapEl.clientWidth || 300, h = wrapEl.clientHeight || 300;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(35, w / h, 0.05, 100);
      camera.position.set(2.2, 1.4, 3.2);

      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h);
      renderer.outputEncoding = THREE.sRGBEncoding;
      wrapEl.insertBefore(renderer.domElement, wrapEl.firstChild);

      const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a3d, 1.1);
      scene.add(hemi);
      const dir = new THREE.DirectionalLight(0xffffff, 0.5);
      dir.position.set(2, 4, 3);
      scene.add(dir);

      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0.75, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 1.2;
      controls.maxDistance = 6;
      controls.update();

      window.addEventListener('resize', onResize);
      new ResizeObserver(onResize).observe(wrapEl);

      loadModel();
      animate();
    }

    function onResize() {
      const w = wrapEl.clientWidth, h = wrapEl.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }

    function makeDefaultCapeCanvas() {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 32;
      const cx = c.getContext('2d');
      cx.fillStyle = '#5b3a29';
      cx.fillRect(0, 0, 64, 32);
      cx.fillStyle = '#FFD500';
      cx.fillRect(2, 2, 12, 12);
      return c;
    }

    function makeDefaultSkinCanvas() {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const cx = c.getContext('2d');
      cx.fillStyle = '#cf9e76';
      cx.fillRect(0, 0, 64, 64);
      cx.fillStyle = '#3b5da0';
      cx.fillRect(20, 20, 24, 24);
      return c;
    }

    function drawDefaultSteveSkinInto(canvas, onLoaded) {
      const cx = canvas.getContext('2d');
      cx.imageSmoothingEnabled = false;
      const img = new Image();
      img.onload = () => {
        cx.clearRect(0, 0, 64, 64);
        cx.drawImage(img, 0, 0, 64, 64);
        if (typeof onLoaded === 'function') onLoaded();
      };
      img.onerror = () => {
        console.warn('تعذّر تحميل سكن ستيف الافتراضي المدمج؛ سيبقى الملء البديل ظاهراً.');
      };
      img.src = 'data:image/png;base64,' + DEFAULT_STEVE_SKIN_B64;
    }

    function normalizeSkinImageToCanvas(img) {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = false;
      cx.clearRect(0, 0, 64, 64);
      cx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, 64, img.naturalHeight >= img.naturalWidth ? 64 : 32);
      return c;
    }

    function loadModel() {
      const loader = new THREE.GLTFLoader();
      const jsonStr = JSON.stringify(STEVE_GLTF_JSON);
      const dataUri = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(jsonStr)));
      loader.load(dataUri, (gltf) => {
        const root = gltf.scene;
        root.scale.set(0.62, 0.62, 0.62);
        root.position.y = -0.05;
        scene.add(root);

        const capeCanvas = makeDefaultCapeCanvas();
        capeTexture = new THREE.CanvasTexture(getFlippedCapeCanvas(capeCanvas));
        capeTexture.magFilter = THREE.NearestFilter;
        capeTexture.minFilter = THREE.NearestFilter;
        capeTexture.flipY = false;

        const skinCanvas = makeDefaultSkinCanvas();
        skinTexture = new THREE.CanvasTexture(skinCanvas);
        skinTexture.magFilter = THREE.NearestFilter;
        skinTexture.minFilter = THREE.NearestFilter;
        skinTexture.flipY = false;

        drawDefaultSteveSkinInto(skinCanvas, () => {
          skinTexture.needsUpdate = true;
        });

        const capeMaterial = new THREE.MeshStandardMaterial({
          map: capeTexture,
          transparent: true,
          alphaTest: 0.1,
          side: THREE.DoubleSide,
          roughness: 1,
          metalness: 0
        });

        const skinMaterial = new THREE.MeshStandardMaterial({
          map: skinTexture,
          transparent: true,
          alphaTest: 0.1,
          side: THREE.FrontSide,
          roughness: 1,
          metalness: 0
        });

        root.traverse((obj) => {
          if (!obj.isMesh) return;
          const nodeName = obj.name || '';
          const parentName = obj.parent ? (obj.parent.name || '') : '';
          const grandparentName = obj.parent && obj.parent.parent ? (obj.parent.parent.name || '') : '';
          const isCape = nodeName.toLowerCase().includes('cape') ||
                         parentName.toLowerCase().includes('cape') ||
                         grandparentName.toLowerCase().includes('cape');

          if (isCape && !capeMesh) {
            capeMesh = obj;
            obj.material = capeMaterial;
          } else {
            bodyMeshes.push(obj);
            obj.material = skinMaterial;
          }
        });

        ready = true;
        if (loadingEl) loadingEl.style.display = 'none';
      }, undefined, (err) => {
        console.error('GLTF load error', err);
        if (loadingEl) loadingEl.textContent = 'تعذّر تحميل النموذج ثلاثي الأبعاد';
      });
    }

    let capeFlipCanvas = null, capeFlipCtx = null;
    function getFlippedCapeCanvas(sourceCanvas) {
      if (!capeFlipCanvas) {
        capeFlipCanvas = document.createElement('canvas');
        capeFlipCanvas.width = sourceCanvas.width;
        capeFlipCanvas.height = sourceCanvas.height;
        capeFlipCtx = capeFlipCanvas.getContext('2d');
        capeFlipCtx.imageSmoothingEnabled = false;
      }
      if (capeFlipCanvas.width !== sourceCanvas.width || capeFlipCanvas.height !== sourceCanvas.height) {
        capeFlipCanvas.width = sourceCanvas.width;
        capeFlipCanvas.height = sourceCanvas.height;
      }
      capeFlipCtx.save();
      capeFlipCtx.clearRect(0, 0, capeFlipCanvas.width, capeFlipCanvas.height);
      capeFlipCtx.translate(0, capeFlipCanvas.height);
      capeFlipCtx.scale(1, -1);
      capeFlipCtx.drawImage(sourceCanvas, 0, 0);
      capeFlipCtx.restore();
      return capeFlipCanvas;
    }

    function updateCapeTextureFromFrame(canvasFrame) {
      if (!capeTexture) return;
      capeTexture.image = getFlippedCapeCanvas(canvasFrame);
      capeTexture.needsUpdate = true;
    }

    function animate(t) {
      requestAnimationFrame(animate);
      if (!ready) {
        if (renderer && controls) controls.update();
        if (renderer) renderer.render(scene, camera);
        return;
      }

      if (playing && capeFrames.length && t - lastFrameTime > frameDelay) {
        lastFrameTime = t;
        capeFrameIdx = (capeFrameIdx + 1) % capeFrames.length;
        updateCapeTextureFromFrame(capeFrames[capeFrameIdx]);
      }

      controls.update();
      renderer.render(scene, camera);
    }

    initThree();

    // ---- Public API ----
    return {
      setCapeFrames(frames) {
        capeFrames = frames;
        capeFrameIdx = 0;
        if (frames.length) updateCapeTextureFromFrame(frames[0]);
        else if (capeTexture) updateCapeTextureFromFrame(makeDefaultCapeCanvas());
      },
      setPlaying(v) { playing = v; },
      isPlaying() { return playing; },
      setFrameDelay(ms) { frameDelay = ms; },
      setSkinFromImageElement(imgEl) {
        if (!skinTexture) return;
        const c = normalizeSkinImageToCanvas(imgEl);
        skinTexture.image = c;
        skinTexture.needsUpdate = true;
      },
      resetSkinToDefault() {
        if (!skinTexture) return;
        const c = makeDefaultSkinCanvas();
        skinTexture.image = c;
        skinTexture.needsUpdate = true;
        drawDefaultSteveSkinInto(c, () => { skinTexture.needsUpdate = true; });
      }
    };
  }

  window.CapeViewer3D = { init };
})();
