import * as THREE from 'three';

// Canvas2D fallback for environments that disable WebGL. It projects the same
// real scene geometry used by the WebGL renderer; picking/controls/export remain
// in SceneView and therefore share the identical object and transform state.
export class SoftwareSceneRenderer {
  constructor({ canvas }) {
    this.domElement = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    if (!this.context) throw new Error('This browser cannot create a 2D or WebGL canvas.');
    this.isSoftwareRenderer = true;
    this.capabilities = { getMaxAnisotropy: () => 1 };
    this.shadowMap = { enabled: false, type: null };
    this.info = { render: { calls: 0, triangles: 0, lines: 0 }, memory: {} };
    this._pixelRatio = 1;
    this._width = 1;
    this._height = 1;
    this._projection = new THREE.Matrix4();
    this._combined = new THREE.Matrix4();
    this._normalMatrix = new THREE.Matrix3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._light = new THREE.Vector3(-28, 65, 38).normalize();
    this._shade = new THREE.Color();
    this._srgb = new THREE.Color();
    this._fogColor = new THREE.Color('#dce7eb');
    this._patterns = new WeakMap();
    this._frameSignature = null;
    this._texturePixels = new WeakMap();
    this._lastFrame = 0;
  }

  setPixelRatio(ratio) { this._pixelRatio = Math.min(1.25, Math.max(1, Number(ratio) || 1)); }

  getPixelRatio() { return this._pixelRatio; }

  setSize(width, height, updateStyle = false) {
    this._width = Math.max(1, Math.round(width));
    this._height = Math.max(1, Math.round(height));
    // Bound software rasterization work independently of high-DPI displays.
    this._renderScale = Math.min(this._pixelRatio, 960 / this._width, 760 / this._height);
    this._rasterWidth = Math.max(1, Math.round(this._width * this._renderScale));
    this._rasterHeight = Math.max(1, Math.round(this._height * this._renderScale));
    this.domElement.width = this._rasterWidth;
    this.domElement.height = this._rasterHeight;
    this._image = this.context.createImageData(this._rasterWidth, this._rasterHeight);
    this._depth = new Float32Array(this._rasterWidth * this._rasterHeight);
    this._sky = new Uint8ClampedArray(this._image.data.length);
    const stops = [[195, 219, 232], [229, 236, 234], [233, 230, 220]];
    for (let y = 0; y < this._rasterHeight; y++) {
      const t = y / Math.max(1, this._rasterHeight - 1);
      const a = t < 0.65 ? stops[0] : stops[1], b = t < 0.65 ? stops[1] : stops[2];
      const f = t < 0.65 ? t / 0.65 : (t - 0.65) / 0.35;
      const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * f));
      for (let x = 0; x < this._rasterWidth; x++) {
        const i = (y * this._rasterWidth + x) * 4;
        this._sky[i] = rgb[0]; this._sky[i + 1] = rgb[1]; this._sky[i + 2] = rgb[2]; this._sky[i + 3] = 255;
      }
    }
    if (updateStyle) {
      this.domElement.style.width = `${this._width}px`;
      this.domElement.style.height = `${this._height}px`;
    }
    this._patterns = new WeakMap();
    this._frameSignature = null;
  }

  _screen(v) {
    const inverseW = 1 / v[3];
    return [(v[0] * inverseW * 0.5 + 0.5) * this._width, (-v[1] * inverseW * 0.5 + 0.5) * this._height];
  }

  _nearClip(vertices) {
    const result = [];
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      const da = a[2] + a[3], db = b[2] + b[3];
      const insideA = da >= 0, insideB = db >= 0;
      if (insideA) result.push(a);
      if (insideA !== insideB) {
        const t = da / (da - db);
        result.push(a.map((value, k) => value + (b[k] - value) * t));
      }
    }
    return result.filter((v) => v[3] > 0.00001);
  }

  _outside(vertices) {
    return vertices.every((v) => v[0] < -v[3]) || vertices.every((v) => v[0] > v[3]) ||
      vertices.every((v) => v[1] < -v[3]) || vertices.every((v) => v[1] > v[3]) ||
      vertices.every((v) => v[2] > v[3]) || vertices.every((v) => v[2] < -v[3]);
  }

  _vertexCache(geometry, matrix) {
    const position = geometry.getAttribute('position');
    if (!position) return [];
    const e = matrix.elements;
    const vertices = new Array(position.count);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      vertices[i] = [
        e[0] * x + e[4] * y + e[8] * z + e[12],
        e[1] * x + e[5] * y + e[9] * z + e[13],
        e[2] * x + e[6] * y + e[10] * z + e[14],
        e[3] * x + e[7] * y + e[11] * z + e[15],
      ];
    }
    return vertices;
  }

  _mesh(object, queue, camera) {
    const geometry = object.geometry;
    const position = geometry?.getAttribute('position');
    if (!position) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (!material || material.visible === false || material.opacity <= 0) return;
    this._combined.multiplyMatrices(this._projection, object.matrixWorld);
    this._normalMatrix.getNormalMatrix(object.matrixWorld);
    const vertices = this._vertexCache(geometry, this._combined);
    const index = geometry.index?.array;
    const uv = geometry.getAttribute('uv');
    const count = index ? index.length : position.count;
    const start = Math.max(0, geometry.drawRange.start || 0);
    const finish = Math.min(count, start + geometry.drawRange.count);
    for (let i = start; i + 2 < finish; i += 3) {
      const ia = index ? index[i] : i, ib = index ? index[i + 1] : i + 1, ic = index ? index[i + 2] : i + 2;
      const triangle = [vertices[ia], vertices[ib], vertices[ic]];
      if (this._outside(triangle)) continue;
      let clipped = triangle;
      if (triangle.some((v) => v[2] < -v[3] || v[3] <= 0)) clipped = this._nearClip(triangle);
      if (clipped.length < 3) continue;
      const points = clipped.map((v) => this._screen(v));
      if (points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
      const area = (points[1][0] - points[0][0]) * (points[2][1] - points[0][1]) - (points[1][1] - points[0][1]) * (points[2][0] - points[0][0]);
      if (Math.abs(area) < 0.1) continue;
      if (material.side === THREE.FrontSide && area > 0) continue;
      if (material.side === THREE.BackSide && area < 0) continue;
      this._a.fromBufferAttribute(position, ia);
      this._b.fromBufferAttribute(position, ib).sub(this._a);
      this._c.fromBufferAttribute(position, ic).sub(this._a);
      this._normal.crossVectors(this._b, this._c).applyMatrix3(this._normalMatrix).normalize();
      if (area > 0) this._normal.negate();
      const light = material.isMeshBasicMaterial ? 1 : 0.63 + Math.max(0, this._normal.dot(this._light)) * 0.52;
      const depth = clipped.reduce((sum, v) => sum + v[3], 0) / clipped.length;
      this._shade.copy(material.color || new THREE.Color('#cccccc')).multiplyScalar(light);
      const fog = object.material?.fog === false ? 0 : THREE.MathUtils.clamp((depth - 150) / 270, 0, 1);
      this._shade.lerp(this._fogColor, fog);
      this._srgb.copy(this._shade).convertLinearToSRGB();
      const texture = clipped === triangle && uv && material.map?.image && fog < 0.8 ? material.map : null;
      const textureUV = texture ? [[uv.getX(ia), uv.getY(ia)], [uv.getX(ib), uv.getY(ib)], [uv.getX(ic), uv.getY(ic)]] : null;
      queue.push({ type: 'face', points, depth, order: material.depthTest === false ? Math.max(200, object.renderOrder || 0) : object.renderOrder || 0,
        fill: this._shade.getStyle(THREE.SRGBColorSpace), opacity: material.opacity,
        rgb: [this._srgb.r, this._srgb.g, this._srgb.b].map((v) => Math.round(255 * THREE.MathUtils.clamp(v, 0, 1))),
        clip: clipped, texture, uv: textureUV, material });
    }
  }

  _lines(object, queue) {
    const geometry = object.geometry;
    if (!geometry?.getAttribute('position')) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (!material || material.visible === false || material.opacity <= 0) return;
    this._combined.multiplyMatrices(this._projection, object.matrixWorld);
    const vertices = this._vertexCache(geometry, this._combined);
    const index = geometry.index?.array;
    const count = index ? index.length : vertices.length;
    const step = object.isLineSegments ? 2 : 1;
    const finish = object.isLineLoop ? count : count - 1;
    for (let i = 0; i < finish; i += step) {
      let a = vertices[index ? index[i] : i];
      let b = vertices[index ? index[(i + 1) % count] : (i + 1) % count];
      if (!a || !b || this._outside([a, b])) continue;
      const da = a[2] + a[3], db = b[2] + b[3];
      if (da < 0 && db < 0) continue;
      if (da < 0 || db < 0) {
        const t = da / (da - db);
        const middle = a.map((v, k) => v + (b[k] - v) * t);
        if (da < 0) a = middle; else b = middle;
      }
      if (a[3] <= 0 || b[3] <= 0) continue;
      queue.push({ type: 'line', points: [this._screen(a), this._screen(b)], depth: (a[3] + b[3]) / 2,
        order: material.depthTest === false ? 200 : object.renderOrder || 0,
        stroke: material.color.getStyle(THREE.SRGBColorSpace), opacity: material.opacity,
        width: Math.min(3, Math.max(1.2, material.linewidth || 1)) });
    }
  }

  _texture(face) {
    const image = face.texture.image;
    if (!image?.width || !image?.height) return;
    let pattern = this._patterns.get(image);
    if (!pattern) { pattern = this.context.createPattern(image, 'repeat'); if (pattern) this._patterns.set(image, pattern); }
    if (!pattern) return;
    const p = face.points;
    const t = face.uv.map(([u, v]) => [u * image.width, (1 - v) * image.height]);
    const u1 = t[1][0] - t[0][0], v1 = t[1][1] - t[0][1];
    const u2 = t[2][0] - t[0][0], v2 = t[2][1] - t[0][1];
    const determinant = u1 * v2 - u2 * v1;
    if (Math.abs(determinant) < 1e-5) return;
    const x1 = p[1][0] - p[0][0], y1 = p[1][1] - p[0][1];
    const x2 = p[2][0] - p[0][0], y2 = p[2][1] - p[0][1];
    const a = (x1 * v2 - x2 * v1) / determinant;
    const b = (y1 * v2 - y2 * v1) / determinant;
    const c = (u1 * x2 - u2 * x1) / determinant;
    const d = (u1 * y2 - u2 * y1) / determinant;
    const e = p[0][0] - a * t[0][0] - c * t[0][1];
    const f = p[0][1] - b * t[0][0] - d * t[0][1];
    if (![a, b, c, d, e, f].every(Number.isFinite)) return;
    const ctx = this.context;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[1][0], p[1][1]); ctx.lineTo(p[2][0], p[2][1]); ctx.closePath(); ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = pattern;
    const minX = Math.min(...t.map((v) => v[0])) - 1, minY = Math.min(...t.map((v) => v[1])) - 1;
    ctx.fillRect(minX, minY, Math.max(...t.map((v) => v[0])) - minX + 1, Math.max(...t.map((v) => v[1])) - minY + 1);
    ctx.restore();
  }

  _pixelsFor(texture) {
    const image = texture?.image;
    if (!image?.width || !image?.height || !image.getContext) return null;
    let cached = this._texturePixels.get(image);
    if (!cached) {
      const data = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
      cached = { data, width: image.width, height: image.height };
      this._texturePixels.set(image, cached);
    }
    return cached;
  }

  _rasterTriangle(face, ia, ib, ic) {
    const scale = this._renderScale;
    const p0 = face.points[ia], p1 = face.points[ib], p2 = face.points[ic];
    const x0 = p0[0] * scale, y0 = p0[1] * scale;
    const x1 = p1[0] * scale, y1 = p1[1] * scale;
    const x2 = p2[0] * scale, y2 = p2[1] * scale;
    const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    if (Math.abs(area) < 0.01) return;
    const width = this._rasterWidth, height = this._rasterHeight;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) return;
    const dx0 = (y1 - y2) / area, dy0 = (x2 - x1) / area;
    const dx1 = (y2 - y0) / area, dy1 = (x0 - x2) / area;
    let row0 = ((y1 - y2) * (minX + 0.5) + (x2 - x1) * (minY + 0.5) + x1 * y2 - x2 * y1) / area;
    let row1 = ((y2 - y0) * (minX + 0.5) + (x0 - x2) * (minY + 0.5) + x2 * y0 - x0 * y2) / area;
    const w0 = 1 / face.clip[ia][3], w1 = 1 / face.clip[ib][3], w2 = 1 / face.clip[ic][3];
    const z0 = face.clip[ia][2] * w0, z1 = face.clip[ib][2] * w1, z2 = face.clip[ic][2] * w2;
    const texture = this._pixelsFor(face.texture);
    const uv0 = texture ? face.uv[ia] : null, uv1 = texture ? face.uv[ib] : null, uv2 = texture ? face.uv[ic] : null;
    const pixels = this._image.data, depth = this._depth;
    const red = face.rgb[0], green = face.rgb[1], blue = face.rgb[2];
    const alpha = face.opacity ?? 1;
    for (let y = minY; y <= maxY; y++) {
      let b0 = row0, b1 = row1;
      let pixel = y * width + minX;
      for (let x = minX; x <= maxX; x++, pixel++, b0 += dx0, b1 += dx1) {
        const b2 = 1 - b0 - b1;
        if (b0 < -1e-7 || b1 < -1e-7 || b2 < -1e-7) continue;
        const z = b0 * z0 + b1 * z1 + b2 * z2;
        if (z > depth[pixel]) continue;
        let r = red, g = green, b = blue;
        if (texture) {
          const reciprocal = 1 / (b0 * w0 + b1 * w1 + b2 * w2);
          const u = (b0 * uv0[0] * w0 + b1 * uv1[0] * w1 + b2 * uv2[0] * w2) * reciprocal;
          const v = (b0 * uv0[1] * w0 + b1 * uv1[1] * w1 + b2 * uv2[1] * w2) * reciprocal;
          const tx = Math.min(texture.width - 1, Math.floor((u - Math.floor(u)) * texture.width));
          const ty = Math.min(texture.height - 1, Math.floor((1 - (v - Math.floor(v))) * texture.height));
          const ti = (ty * texture.width + tx) * 4;
          r *= texture.data[ti] / 255; g *= texture.data[ti + 1] / 255; b *= texture.data[ti + 2] / 255;
        }
        const p = pixel * 4;
        if (alpha < 1) {
          pixels[p] = r * alpha + pixels[p] * (1 - alpha);
          pixels[p + 1] = g * alpha + pixels[p + 1] * (1 - alpha);
          pixels[p + 2] = b * alpha + pixels[p + 2] * (1 - alpha);
        } else { pixels[p] = r; pixels[p + 1] = g; pixels[p + 2] = b; }
        if (face.material.depthWrite !== false) depth[pixel] = z;
      }
      row0 += dy0; row1 += dy1;
    }
  }

  render(scene, camera) {
    const now = performance.now();
    if (now - this._lastFrame < 1000 / 30) return;
    this._lastFrame = now;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this._projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // Do not rasterize an unchanged street at animation-frame frequency. This
    // keeps inspector/edit controls responsive on machines without WebGL.
    let signature = this._projection.elements.map((v) => Math.round(v * 1e6)).join(',');
    scene.traverseVisible((object) => {
      if (!object.isMesh && !object.isLine) return;
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      signature += `|${object.geometry?.id}:${object.geometry?.getAttribute('position')?.version || 0}:${material?.id}:${material?.map?.id || 0}:${material?.opacity}:${material?.color?.r},${material?.color?.g},${material?.color?.b}`;
      signature += object.matrixWorld.elements.map((v) => Math.round(v * 1e6)).join(',');
    });
    if (signature === this._frameSignature) return;
    this._frameSignature = signature;
    const ctx = this.context;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    this._image.data.set(this._sky);
    this._depth.fill(Infinity);
    const queue = [];
    scene.traverseVisible((object) => {
      if (object.isMesh) this._mesh(object, queue, camera);
      else if (object.isLine) this._lines(object, queue);
    });
    queue.sort((a, b) => a.order - b.order || b.depth - a.depth);
    let triangles = 0, lines = 0;
    for (const entry of queue) {
      if (entry.type !== 'face' || entry.order >= 200) continue;
      for (let i = 1; i + 1 < entry.points.length; i++) this._rasterTriangle(entry, 0, i, i + 1);
      triangles += entry.points.length - 2;
    }
    ctx.putImageData(this._image, 0, 0);
    ctx.setTransform(this._renderScale, 0, 0, this._renderScale, 0, 0);
    for (const entry of queue) {
      if (entry.type === 'face' && entry.order < 200) continue;
      ctx.globalAlpha = entry.opacity ?? 1;
      const points = entry.points;
      ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
      if (entry.type === 'face') {
        ctx.closePath(); ctx.fillStyle = entry.fill; ctx.fill();
        if (entry.texture) this._texture(entry);
        triangles += points.length - 2;
      } else {
        ctx.strokeStyle = entry.stroke; ctx.lineWidth = entry.width; ctx.lineCap = 'round'; ctx.stroke(); lines++;
      }
    }
    ctx.globalAlpha = 1;
    this.info.render = { calls: queue.length, triangles, lines };
  }

  dispose() { this._patterns = new WeakMap(); this._texturePixels = new WeakMap(); }
}

export default SoftwareSceneRenderer;
