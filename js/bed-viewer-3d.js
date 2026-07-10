/* =====================================================================
   Bed 3D viewer — refactored from the original standalone bed tool.
   No hardcoded element IDs: the host page passes its own DOM elements in.

   Public API: window.BedViewer3D.init({ wrapEl, loadingEl })
     -> { updateTextureFromCanvas(canvas2d) }
   ===================================================================== */

(function () {
  function init({ wrapEl, loadingEl }) {
    let scene, camera, renderer, controls, gltfScene;
    let texture = null;
    let ready = false;

    function initThree() {
      const width = wrapEl.clientWidth || 300;
      const height = wrapEl.clientHeight || 300;

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x111111);

      camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
      camera.position.set(3, 2.5, 3);
      camera.lookAt(0, 0.2, 0);

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      wrapEl.insertBefore(renderer.domElement, wrapEl.firstChild);

      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.target.set(0, 0.2, 0);

      scene.add(new THREE.AmbientLight(0x445566, 0.3));
      const main = new THREE.DirectionalLight(0xffffff, 0.9);
      main.position.set(3, 5, 2);
      main.castShadow = true;
      scene.add(main);
      const fill = new THREE.DirectionalLight(0x334455, 0.3);
      fill.position.set(-2, 2, -2);
      scene.add(fill);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      loadGLTF();
      animate();

      window.addEventListener('resize', onResize);
      new ResizeObserver(onResize).observe(wrapEl);
    }

    function onResize() {
      const w = wrapEl.clientWidth, h = wrapEl.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }

    function loadGLTF() {
      const loader = new THREE.GLTFLoader();
      loader.parse(JSON.stringify(GLTF_JSON), '', (gltf) => {
        gltfScene = gltf.scene;
        scene.add(gltfScene);
        ready = true;
        if (loadingEl) loadingEl.style.display = 'none';
        if (texture) applyTextureToModel();
      }, (error) => {
        console.error('GLTF loading error:', error);
        if (loadingEl) loadingEl.textContent = 'تعذّر تحميل النموذج ثلاثي الأبعاد';
      });
    }

    function applyTextureToModel() {
      if (!gltfScene || !texture) return;
      gltfScene.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        if (Array.isArray(obj.material)) {
          obj.material = obj.material.map((m) => {
            const nm = m.clone();
            nm.map = texture;
            nm.needsUpdate = true;
            return nm;
          });
        } else {
          obj.material = obj.material.clone();
          obj.material.map = texture;
          obj.material.needsUpdate = true;
        }
      });
    }

    function animate() {
      requestAnimationFrame(animate);
      if (controls) controls.update();
      if (renderer && scene && camera) renderer.render(scene, camera);
    }

    initThree();

    return {
      updateTextureFromCanvas(canvas2d) {
        texture = new THREE.CanvasTexture(canvas2d);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.flipY = false;
        if (ready) applyTextureToModel();
      }
    };
  }

  window.BedViewer3D = { init };
})();
