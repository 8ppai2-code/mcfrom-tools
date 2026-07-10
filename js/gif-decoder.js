
function parseGIF(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  let pos = 0;
  function readByte() { return buf[pos++]; }
  function readWord() { const v = buf[pos] | (buf[pos+1] << 8); pos += 2; return v; }
  function readBytes(n) { const v = buf.slice(pos, pos+n); pos += n; return v; }

  const header = String.fromCharCode(...readBytes(6));
  if (header.indexOf('GIF') !== 0) throw new Error('ليس ملف GIF صالح');

  const width = readWord();
  const height = readWord();
  const packed = readByte();
  const gctFlag = (packed & 0x80) !== 0;
  const gctSize = 2 << (packed & 0x07);
  readByte(); readByte();

  let gct = null;
  if (gctFlag) { gct = new Uint8Array(gctSize * 3); gct.set(readBytes(gctSize * 3)); }

  const frames = [];
  let transparentIndex = -1, disposalMethod = 0, delayTime = 10;

  function readSubBlocks() {
    let result = [], size;
    while ((size = readByte()) !== 0) {
      for (let i = 0; i < size; i++) result.push(buf[pos + i]);
      pos += size;
    }
    return new Uint8Array(result);
  }

  while (pos < buf.length) {
    const blockType = readByte();
    if (blockType === 0x21) {
      const label = readByte();
      if (label === 0xF9) {
        readByte();
        const packedGCE = readByte();
        disposalMethod = (packedGCE >> 2) & 0x07;
        const transparentFlag = packedGCE & 0x01;
        delayTime = readWord();
        const transIdx = readByte();
        transparentIndex = transparentFlag ? transIdx : -1;
        readByte();
      } else { readSubBlocks(); }
    } else if (blockType === 0x2C) {
      const left = readWord(), top = readWord();
      const imgWidth = readWord(), imgHeight = readWord();
      const imgPacked = readByte();
      const lctFlag = (imgPacked & 0x80) !== 0;
      const interlaced = (imgPacked & 0x40) !== 0;
      const lctSize = 2 << (imgPacked & 0x07);

      let colorTable = gct;
      if (lctFlag) { colorTable = new Uint8Array(lctSize * 3); colorTable.set(readBytes(lctSize * 3)); }

      const minCodeSize = readByte();
      const compressedData = readSubBlocks();
      const indices = lzwDecode(minCodeSize, compressedData, imgWidth * imgHeight);
      let finalIndices = interlaced ? deinterlace(indices, imgWidth, imgHeight) : indices;

      frames.push({ left, top, width: imgWidth, height: imgHeight, colorTable, transparentIndex, disposalMethod, delayTime, indices: finalIndices });
      transparentIndex = -1; disposalMethod = 0;
    } else if (blockType === 0x3B) { break; } else { break; }
  }
  return { width, height, frames };
}

function deinterlace(indices, width, height) {
  const result = new Uint8Array(indices.length);
  const rowsOrder = [];
  for (let y = 0; y < height; y += 8) rowsOrder.push(y);
  for (let y = 4; y < height; y += 8) rowsOrder.push(y);
  for (let y = 2; y < height; y += 4) rowsOrder.push(y);
  for (let y = 1; y < height; y += 2) rowsOrder.push(y);
  let srcRow = 0;
  for (const destRow of rowsOrder) {
    const srcStart = srcRow * width, destStart = destRow * width;
    result.set(indices.subarray(srcStart, srcStart + width), destStart);
    srcRow++;
  }
  return result;
}

function lzwDecode(minCodeSize, data, pixelCount) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dict = [];
  let output = new Uint8Array(pixelCount);
  let outputPos = 0;

  function resetDict() {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict[i] = [i];
    dict[clearCode] = []; dict[eoiCode] = null;
    codeSize = minCodeSize + 1;
  }
  resetDict();

  let bitPos = 0;
  const totalBits = data.length * 8;
  function readCode() {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      if (bitPos >= totalBits) return eoiCode;
      const byteIndex = bitPos >> 3, bitIndex = bitPos & 7;
      const bit = (data[byteIndex] >> bitIndex) & 1;
      code |= bit << i;
      bitPos++;
    }
    return code;
  }

  let prevCode = null;
  while (outputPos < pixelCount) {
    const code = readCode();
    if (code === clearCode) { resetDict(); prevCode = null; continue; }
    if (code === eoiCode) break;

    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (code === dict.length && prevCode !== null) entry = dict[prevCode].concat([dict[prevCode][0]]);
    else break;

    for (let i = 0; i < entry.length && outputPos < pixelCount; i++) output[outputPos++] = entry[i];

    if (prevCode !== null && dict.length < 4096) {
      dict.push(dict[prevCode].concat([entry[0]]));
      if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prevCode = code;
  }
  return output;
}

function framesToCanvases(gifData) {
  const { width, height, frames } = gifData;
  const canvases = [];
  const mainCanvas = document.createElement('canvas');
  mainCanvas.width = width; mainCanvas.height = height;
  const mainCtx = mainCanvas.getContext('2d');

  for (const frame of frames) {
    const { left, top, width: fw, height: fh, colorTable, transparentIndex, disposalMethod, indices } = frame;
    let savedForRestore = null;
    if (disposalMethod === 3) savedForRestore = mainCtx.getImageData(0, 0, width, height);

    const frameImageData = mainCtx.createImageData(fw, fh);
    for (let i = 0; i < fw * fh; i++) {
      const colorIndex = indices[i];
      const di = i * 4;
      if (colorIndex === transparentIndex) {
        frameImageData.data[di + 3] = 0;
      } else {
        const ci = colorIndex * 3;
        frameImageData.data[di] = colorTable[ci];
        frameImageData.data[di + 1] = colorTable[ci + 1];
        frameImageData.data[di + 2] = colorTable[ci + 2];
        frameImageData.data[di + 3] = 255;
      }
    }

    const patchCanvas = document.createElement('canvas');
    patchCanvas.width = fw; patchCanvas.height = fh;
    patchCanvas.getContext('2d').putImageData(frameImageData, 0, 0);
    mainCtx.drawImage(patchCanvas, left, top);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = width; outCanvas.height = height;
    outCanvas.getContext('2d').drawImage(mainCanvas, 0, 0);
    canvases.push(outCanvas);

    if (disposalMethod === 2) mainCtx.clearRect(left, top, fw, fh);
    else if (disposalMethod === 3 && savedForRestore) mainCtx.putImageData(savedForRestore, 0, 0);
  }
  return canvases;
}
