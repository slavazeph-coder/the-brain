/* BrainSNN tabletop arena: real XYZ geometry, perspective WebGL rendering,
 * and time-varying scenarios. Bounded kinematic toy simulation, not a
 * dynamics engine, learned policy, or real-robot validation. No dependencies.
 */
(function (root) {
  'use strict';
  var DT = 0.1, SPEED = 0.65, LIMIT = 1600;
  var BOUNDS = [[-1.35, 1.35], [-0.85, 0.85], [0.08, 1.1]];
  // This camera is an observation contract for the bounded demo. It is never
  // coupled to an orbiting spectator view or a user's screen pixel density.
  // Real policy adapters must provide their own calibrated camera contract.
  var SENSOR_CAMERA = { id: 'bounded-tabletop-agentview-v1',
    eye: [2.7, -3.7, 3.8], target: [0, 0, 0.42], fovY: 0.76 };
  var caches = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function hash(seed) {
    if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
    var h = 2166136261, s = String(seed == null ? 1 : seed);
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a += 0x6D2B79F5;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul(a, n) { return [a[0] * n, a[1] * n, a[2] * n]; }
  function length(a) { return Math.hypot(a[0], a[1], a[2]); }
  function distance(a, b) { return length(sub(a, b)); }
  function norm(a) { var l = length(a) || 1; return mul(a, 1 / l); }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  function create(seed, opts) {
    opts = opts || {};
    var challenge = ['starter', 'clutter', 'moving', 'night', 'surprise'].indexOf(opts.challenge) >= 0 ? opts.challenge : 'starter';
    var clutter = typeof opts.clutter === 'boolean' ? opts.clutter : challenge !== 'starter';
    var movingObstacle = typeof opts.movingObstacle === 'boolean' ? opts.movingObstacle : challenge === 'moving' || challenge === 'surprise';
    var n = hash(seed), random = rng(n);
    var offsets = [[-0.95, -0.48], [-0.68, 0.44], [-0.28, -0.38]];
    var colors = [[0.41, 0.92, 1], [0.58, 0.49, 1], [0.39, 1, 0.82]];
    var objects = offsets.map(function (p, i) {
      return { id: 'block-' + (i + 1), position: [p[0] + (random() - 0.5) * 0.14,
        p[1] + (random() - 0.5) * 0.1, 0.08], size: [0.14, 0.14, 0.16],
        color: colors[i], delivered: false };
    });
    var obstacles = [];
    if (clutter) {
      obstacles.push({ id: 'clutter-1', position: [0.46, -0.52, 0.13], size: [0.25, 0.2, 0.26], dynamic: false });
      obstacles.push({ id: 'clutter-2', position: [-0.02, 0.57, 0.1], size: [0.19, 0.23, 0.2], dynamic: false });
    }
    if (movingObstacle) obstacles.push({
      id: 'moving-obstacle', position: [0.38, 0, 0.16], size: [0.16, 0.18, 0.32], dynamic: true
    });
    return {
      seed: n, opts: { mission: opts.mission || 'table', challenge: challenge, clutter: clutter,
        movingObstacle: movingObstacle, lighting: challenge === 'night' ? 'night' : 'studio' },
      robot: { position: [0, 0, 0.78], target: [0, 0, 0.78], carrying: null },
      objects: objects, obstacles: obstacles,
      goal: { position: [0.99, 0.45, 0.08], size: [0.47, 0.44, 0.24] },
      bounds: BOUNDS.map(function (p) { return p.slice(); }),
      time: 0, steps: 0, collisions: 0, interventions: 0, delivered: 0,
      done: false, success: false, event: 'ready', failureReason: null,
      targetShifted: false, challengeEvents: [],
      trace: [{ time: 0, position: [0, 0, 0.78], event: 'ready' }],
      _demoStage: 0, _demoObject: 0, _lastCollision: false
    };
  }

  function blocked(state, point) {
    for (var i = 0; i < state.obstacles.length; i++) {
      var o = state.obstacles[i], margin = state.robot.carrying == null ? 0.045 : 0.085;
      if (Math.abs(point[0] - o.position[0]) < o.size[0] / 2 + margin &&
          Math.abs(point[1] - o.position[1]) < o.size[1] / 2 + margin &&
          Math.abs(point[2] - o.position[2]) < o.size[2] / 2 + margin) return o.id;
    }
    return null;
  }

  function step(state, action) {
    if (state.done) return state;
    state.time = Number((state.time + DT).toFixed(6));
    state.steps++;
    state.event = 'wait';
    state.obstacles.forEach(function (o) {
      if (o.dynamic) o.position[1] = Math.sin(state.time * 0.9 + (state.seed % 13) * 0.1) * 0.5;
    });
    // A single deterministic scene change makes temporal recovery observable.
    // Delivered blocks travel with the tray; their score never changes merely
    // because the challenge moved its destination. Preserve the action event.
    if (state.opts.challenge === 'surprise' && !state.targetShifted && state.time >= 6 && state.delivered < state.objects.length) {
      var previousGoal = state.goal.position.slice();
      state.goal.position = [0.75, -0.48, 0.08];
      state.targetShifted = true;
      var shift = { time: state.time, event: 'target-moved', from: previousGoal, to: state.goal.position.slice() };
      state.challengeEvents.push(shift);
      state.trace.push({ time: state.time, position: state.robot.position.slice(), event: 'target-moved',
        from: previousGoal.slice(), to: state.goal.position.slice(), carrying: state.robot.carrying });
      var deliveredIndex = 0;
      state.objects.forEach(function (object) {
        if (object.delivered) {
          object.position = [state.goal.position[0] - 0.13 + deliveredIndex * 0.13, state.goal.position[1], 0.08];
          deliveredIndex++;
        }
      });
    }
    if (action != null) {
      if (typeof action !== 'object' || Array.isArray(action)) state.event = 'invalid-action';
      else if (action.skill === 'move_to') {
        var p = action.position;
        if (!Array.isArray(p) || p.length !== 3 || !p.every(function (v) { return typeof v === 'number' && Number.isFinite(v); })) {
          state.event = 'invalid-position';
        } else if (!p.every(function (v, i) { return v >= BOUNDS[i][0] && v <= BOUNDS[i][1]; })) {
          state.event = 'outside-workspace';
        } else {
          state.robot.target = p.slice(); state.event = 'move-command';
        }
      } else if (action.skill === 'pick') {
        state.robot.target = state.robot.position.slice();
        if (state.robot.carrying != null) state.event = 'already-carrying';
        else {
          var nearest = -1, nearestDistance = 0.135;
          for (var j = 0; j < state.objects.length; j++) {
            var object = state.objects[j], d = distance(state.robot.position, object.position);
            if (!object.delivered && d < nearestDistance) { nearestDistance = d; nearest = j; }
          }
          if (nearest < 0) state.event = 'pick-empty';
          else { state.robot.carrying = nearest; state.event = 'pick'; }
        }
      } else if (action.skill === 'place') {
        state.robot.target = state.robot.position.slice();
        if (state.robot.carrying == null) state.event = 'place-empty';
        else {
          var carried = state.objects[state.robot.carrying], g = state.goal;
          var inBin = Math.abs(state.robot.position[0] - g.position[0]) <= g.size[0] * 0.4 &&
            Math.abs(state.robot.position[1] - g.position[1]) <= g.size[1] * 0.4 && state.robot.position[2] <= 0.25;
          carried.position = [state.robot.position[0], state.robot.position[1], 0.08];
          state.robot.carrying = null;
          if (inBin) {
            carried.delivered = true;
            carried.position = [g.position[0] - 0.13 + state.delivered * 0.13, g.position[1], 0.08];
            state.delivered++; state.event = 'deliver';
            if (state.delivered === state.objects.length) {
              state.done = true; state.success = true; state.event = 'complete';
            }
          } else state.event = 'place-on-table';
        }
      } else if (action.skill === 'request_help') {
        state.interventions++; state.robot.target = state.robot.position.slice(); state.event = 'request-help';
      } else if (action.skill !== 'wait') state.event = 'invalid-skill';
    }

    var delta = sub(state.robot.target, state.robot.position), remaining = length(delta);
    if (!state.done && remaining > 0.001) {
      var next = add(state.robot.position, mul(norm(delta), Math.min(SPEED * DT, remaining)));
      var hit = blocked(state, next);
      if (hit) {
        if (!state._lastCollision) state.collisions++;
        state._lastCollision = true; state.event = 'collision:' + hit;
        state.robot.target = state.robot.position.slice();
      } else {
        state._lastCollision = false; state.robot.position = next;
        if (state.event === 'wait' || state.event === 'move-command') state.event = remaining <= SPEED * DT ? 'arrive' : 'move';
      }
    }
    if (state.robot.carrying != null) state.objects[state.robot.carrying].position = state.robot.position.slice();
    if (!state.done && state.steps >= LIMIT) {
      state.done = true; state.failureReason = 'step-limit'; state.event = 'timeout';
    }
    state.trace.push({ time: state.time, position: state.robot.position.slice(),
      event: state.event, carrying: state.robot.carrying });
    return state;
  }

  // Explicit scripted baseline. It uses the same public skill contract as an
  // external model, moving above clutter before approaching each block/bin.
  function demoAction(state) {
    if (state.done) return { skill: 'wait' };
    while (state._demoObject < state.objects.length && state.objects[state._demoObject].delivered) {
      state._demoObject++; state._demoStage = 0;
    }
    var o = state.objects[state._demoObject];
    if (!o) return { skill: 'wait' };
    var points = [
      [state.robot.position[0], state.robot.position[1], 0.72],
      [o.position[0], o.position[1], 0.72],
      [o.position[0], o.position[1], 0.11],
      null,
      [o.position[0], o.position[1], 0.72],
      [state.goal.position[0], state.goal.position[1], 0.72],
      [state.goal.position[0], state.goal.position[1], 0.16],
      null
    ];
    var stage = state._demoStage;
    if (stage === 3) { state._demoStage++; return { skill: 'pick' }; }
    if (stage === 7) { state._demoStage = 0; return { skill: 'place' }; }
    var target = points[stage];
    if (distance(state.robot.position, target) < 0.025) {
      state._demoStage++; return demoAction(state);
    }
    return { skill: 'move_to', position: target.slice() };
  }

  function identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  function matMultiply(a, b) {
    var r = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var row = 0; row < 4; row++) {
      r[c * 4 + row] = a[row] * b[c * 4] + a[4 + row] * b[c * 4 + 1] +
        a[8 + row] * b[c * 4 + 2] + a[12 + row] * b[c * 4 + 3];
    }
    return r;
  }
  function perspective(fov, aspect, near, far) {
    var f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function lookAt(eye, target) {
    var z = norm(sub(eye, target)), x = norm(cross([0, 0, 1], z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  }
  function model(position, scale) {
    var m = identity(); m[0] = scale[0]; m[5] = scale[1]; m[10] = scale[2];
    m[12] = position[0]; m[13] = position[1]; m[14] = position[2]; return m;
  }
  function bone(a, b, thick) {
    var z = norm(sub(b, a)), reference = Math.abs(z[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
    var x = norm(cross(reference, z)), y = cross(z, x), center = mul(add(a, b), 0.5), l = distance(a, b);
    return [x[0] * thick, x[1] * thick, x[2] * thick, 0,
      y[0] * thick, y[1] * thick, y[2] * thick, 0,
      z[0] * l, z[1] * l, z[2] * l, 0, center[0], center[1], center[2], 1];
  }
  // All model transforms below are orthogonal bases with independent scales.
  // Inverse transpose is essential for rounded meshes under nonuniform scaling.
  function normalMatrix(m) {
    var result = new Float32Array(9);
    for (var c = 0; c < 3; c++) {
      var offset = c * 4, divisor = m[offset] * m[offset] + m[offset + 1] * m[offset + 1] + m[offset + 2] * m[offset + 2];
      divisor = Math.max(divisor, 1e-10);
      result[c * 3] = m[offset] / divisor; result[c * 3 + 1] = m[offset + 1] / divisor;
      result[c * 3 + 2] = m[offset + 2] / divisor;
    }
    return result;
  }
  function buildRenderer(canvas) {
    var gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    var vertexSource = [
      'attribute vec3 aPosition; attribute vec3 aNormal;',
      'uniform mat4 uMVP; uniform mat4 uModel; uniform mat3 uNormal;',
      'varying vec3 vNormal; varying vec3 vPosition; varying vec3 vLocal;',
      'void main(){vNormal=normalize(uNormal*aNormal);vPosition=(uModel*vec4(aPosition,1.0)).xyz;',
      'vLocal=aPosition;gl_Position=uMVP*vec4(aPosition,1.0);}'
    ].join('\n');
    var fragmentSource = [
      'precision mediump float;',
      'uniform vec3 uColor; uniform vec3 uLight; uniform vec3 uEye;',
      'uniform vec4 uStyle; uniform float uMode; uniform float uNight;',
      'varying vec3 vNormal; varying vec3 vPosition; varying vec3 vLocal;',
      'void main(){',
      'if(uMode>1.5){float glow=exp(-dot(vPosition.xy,vPosition.xy)*0.15);',
      'vec3 ground=mix(vec3(0.0235,0.0235,0.0392),vec3(0.058,0.066,0.095),glow);',
      'vec2 cyanSpot=vPosition.xy-vec2(-1.7,1.1);vec2 violetSpot=vPosition.xy-vec2(1.6,1.0);',
      'ground+=vec3(0.0,0.03,0.035)*exp(-dot(cyanSpot,cyanSpot)*0.75);',
      'ground+=vec3(0.018,0.002,0.035)*exp(-dot(violetSpot,violetSpot)*0.8);',
      'gl_FragColor=vec4(ground*mix(1.0,0.56,uNight),1.0);return;}',
      'if(uMode>0.5){float a=1.0-smoothstep(0.08,0.5,length(vLocal.xy));',
      'gl_FragColor=vec4(uColor,a*a*uStyle.x);return;}',
      'vec3 n=normalize(vNormal);vec3 v=normalize(uEye-vPosition);',
      'vec3 l=normalize(uLight-vPosition);vec3 fill=normalize(vec3(-3.0,2.2,2.5)-vPosition);',
      'float diffuse=max(dot(n,l),0.0);float bounce=max(dot(n,fill),0.0);',
      'float hemi=(0.37+0.13*n.z)*mix(1.0,0.24,uNight);',
      'float spec=pow(max(dot(n,normalize(l+v)),0.0),uStyle.y)*uStyle.z;',
      'float soft=pow(max(dot(n,normalize(fill+v)),0.0),18.0)*uStyle.z*0.26;',
      'float fresnel=pow(1.0-max(dot(n,v),0.0),3.0);',
      'vec3 base=pow(uColor,vec3(2.2));',
      'vec3 lit=base*(hemi+mix(0.68,0.32,uNight)*diffuse+mix(0.20,0.08,uNight)*bounce+uStyle.w);',
      'lit+=vec3(0.83,0.91,1.0)*(spec+soft)*mix(1.0,0.58,uNight);',
      'vec3 rim=mix(vec3(0.12,0.57,0.67),vec3(0.38,0.17,0.66),smoothstep(-1.2,1.2,vPosition.x));',
      'lit+=rim*fresnel*(0.028+uStyle.z*0.12)*mix(1.0,1.8,uNight);',
      'lit=lit/(vec3(1.0)+lit*0.15);',
      'gl_FragColor=vec4(pow(max(lit,vec3(0.0)),vec3(0.4545)),uStyle.x);}'
    ].join('\n');
    function shader(kind, source) {
      var s = gl.createShader(kind); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    function vertex(data, p, n) { data.push(p[0], p[1], p[2], n[0], n[1], n[2]); }
    function triangle(data, a, b, c) { vertex(data, a.p, a.n); vertex(data, b.p, b.n); vertex(data, c.p, c.n); }
    function mesh(data) {
      var buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      return { buffer: buffer, count: data.length / 6 };
    }
    function roundedBox(radius) {
      var data = [], edges = [-.5, -.49, -.475, -.45, -.42, -.38, 0, .38, .42, .45, .475, .49, .5];
      var faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
      function point(axis, sign, a, b) {
        var p = [0, 0, 0], center = [0, 0, 0]; p[axis] = sign * .5;
        p[(axis + 1) % 3] = a; p[(axis + 2) % 3] = b;
        for (var k = 0; k < 3; k++) center[k] = clamp(p[k], -.5 + radius, .5 - radius);
        var n = norm(sub(p, center)); return { p: add(center, mul(n, radius)), n: n };
      }
      faces.forEach(function (face) {
        for (var i = 0; i < edges.length - 1; i++) for (var j = 0; j < edges.length - 1; j++) {
          var a = point(face[0], face[1], edges[i], edges[j]);
          var b = point(face[0], face[1], edges[i + 1], edges[j]);
          var c = point(face[0], face[1], edges[i + 1], edges[j + 1]);
          var d = point(face[0], face[1], edges[i], edges[j + 1]);
          if (face[1] > 0) { triangle(data, a, b, c); triangle(data, a, c, d); }
          else { triangle(data, a, c, b); triangle(data, a, d, c); }
        }
      }); return mesh(data);
    }
    function sphere() {
      var data = [], around = 28, vertical = 16;
      function p(i, j) { var theta = i * Math.PI * 2 / around, phi = j * Math.PI / vertical;
        var n = [Math.cos(theta) * Math.sin(phi), Math.sin(theta) * Math.sin(phi), Math.cos(phi)];
        return { p: mul(n, .5), n: n }; }
      for (var i = 0; i < around; i++) for (var j = 0; j < vertical; j++) {
        triangle(data, p(i,j), p(i+1,j), p(i+1,j+1)); triangle(data, p(i,j), p(i+1,j+1), p(i,j+1));
      } return mesh(data);
    }
    function cylinder() {
      var data = [], segments = 36;
      // Revolved, bevelled cylinder: broad caps and smooth curved shoulders.
      var profile = [
        [0,-.5,0,-1], [.42,-.5,0,-1], [.4506,-.4939,.3827,-.9239],
        [.4766,-.4766,.7071,-.7071], [.4939,-.4506,.9239,-.3827],
        [.5,-.42,1,0], [.5,.42,1,0], [.4939,.4506,.9239,.3827],
        [.4766,.4766,.7071,.7071], [.4506,.4939,.3827,.9239], [.42,.5,0,1], [0,.5,0,1]
      ];
      function p(i,j) { var a = i * Math.PI * 2 / segments, b = profile[j];
        return { p: [Math.cos(a)*b[0],Math.sin(a)*b[0],b[1]], n: [Math.cos(a)*b[2],Math.sin(a)*b[2],b[3]] }; }
      for (var i=0;i<segments;i++) for (var j=0;j<profile.length-1;j++) {
        triangle(data,p(i,j),p(i+1,j),p(i+1,j+1));triangle(data,p(i,j),p(i+1,j+1),p(i,j+1));
      } return mesh(data);
    }
    function ring() {
      var data=[], segments=48;
      function p(i,r) {var a=i*Math.PI*2/segments;return {p:[Math.cos(a)*r,Math.sin(a)*r,0],n:[0,0,1]};}
      for(var i=0;i<segments;i++){triangle(data,p(i,.43),p(i,.5),p(i+1,.5));triangle(data,p(i,.43),p(i+1,.5),p(i+1,.43));}
      return mesh(data);
    }
    var plane = [];
    triangle(plane,{p:[-.5,-.5,0],n:[0,0,1]},{p:[.5,-.5,0],n:[0,0,1]},{p:[.5,.5,0],n:[0,0,1]});
    triangle(plane,{p:[-.5,-.5,0],n:[0,0,1]},{p:[.5,.5,0],n:[0,0,1]},{p:[-.5,.5,0],n:[0,0,1]});
    var renderer = { gl: gl, program: program,
      meshes: { box: roundedBox(.12), slab: roundedBox(.06), sphere: sphere(), cylinder: cylinder(), ring: ring(), plane: mesh(plane) },
      pos: gl.getAttribLocation(program, 'aPosition'), normal: gl.getAttribLocation(program, 'aNormal'),
      mvp: gl.getUniformLocation(program, 'uMVP'), transform: gl.getUniformLocation(program, 'uModel'),
      normalTransform: gl.getUniformLocation(program, 'uNormal'), style: gl.getUniformLocation(program, 'uStyle'),
      mode: gl.getUniformLocation(program, 'uMode'), eye: gl.getUniformLocation(program, 'uEye'),
      night: gl.getUniformLocation(program, 'uNight'),
      color: gl.getUniformLocation(program, 'uColor'), light: gl.getUniformLocation(program, 'uLight') };
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return renderer;
  }

  function renderScene(canvas, state, view, sensor) {
    view = view || {};
    var r = caches && caches.get(canvas);
    if (!r) {
      try { r = buildRenderer(canvas); }
      catch (e) { return { ok: false, reason: 'webgl-error', detail: String(e.message || e) }; }
      if (!r) return { ok: false, reason: 'webgl-unavailable' };
      if (caches) caches.set(canvas, r);
    }
    var gl = r.gl, pixelRatio = Math.min(2, root.devicePixelRatio || 1);
    var w = sensor ? view.width : Math.max(1, Math.round(canvas.clientWidth ? canvas.clientWidth * pixelRatio : canvas.width || 800));
    var h = sensor ? view.height : Math.max(1, Math.round(canvas.clientHeight ? canvas.clientHeight * pixelRatio : canvas.height || 500));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h); gl.clearColor(0.0235, 0.0235, 0.0392, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(r.program); gl.enableVertexAttribArray(r.pos); gl.enableVertexAttribArray(r.normal);
    var yaw = typeof view.yaw === 'number' ? view.yaw : -0.95;
    var pitch = clamp(typeof view.pitch === 'number' ? view.pitch : 0.62, 0.15, 1.4);
    var radius = clamp(typeof view.distance === 'number' ? view.distance : 5.1, 2.1, 9);
    // Keep the full platform comfortably framed on narrow screens.
    radius *= Math.max(1, 1.12 / (w / h));
    var target = sensor ? SENSOR_CAMERA.target.slice() : [0, 0, 0.48];
    var eye = sensor ? SENSOR_CAMERA.eye.slice() : [Math.cos(yaw) * Math.cos(pitch) * radius,
      Math.sin(yaw) * Math.cos(pitch) * radius, target[2] + Math.sin(pitch) * radius];
    var vp = matMultiply(perspective(sensor ? SENSOR_CAMERA.fovY : 0.76, w / h, 0.05, 40), lookAt(eye, target));
    gl.uniform3fv(r.eye, eye);
    var night = state.opts && state.opts.challenge === 'night';
    gl.uniform1f(r.night, night ? 1 : 0);
    // The studio key moves gently with scenario time, preserving the temporal cue.
    gl.uniform3fv(r.light, [-1.8 + Math.sin(state.time * 0.22) * .35, -2.8, night ? 2.8 : 5.2]);
    var pearl = [.76,.79,.84], titanium = [.34,.38,.45], graphite = [.12,.14,.20];
    var cyan = [.408,.918,1], purple = [.58,.486,1], mint = [.392,1,.824];
    var material = [1,65,.19,0], matte = [1,42,.045,0], accent = [1,52,.11,.12];
    var clock = !sensor && typeof view.renderTime === 'number' && Number.isFinite(view.renderTime) ? view.renderTime : state.time;
    var pulse = .5 + Math.sin(clock * 2.8) * .5;
    var goalColor = state.success ? mint : state.targetShifted ? purple : cyan;
    function draw(m, color, shape, style, mode) {
      var mesh = r.meshes[shape || 'box'];
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
      gl.vertexAttribPointer(r.pos, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribPointer(r.normal, 3, gl.FLOAT, false, 24, 12);
      gl.uniformMatrix4fv(r.transform, false, new Float32Array(m));
      gl.uniformMatrix3fv(r.normalTransform, false, normalMatrix(m));
      gl.uniformMatrix4fv(r.mvp, false, matMultiply(vp, m));
      gl.uniform3fv(r.color, color); gl.uniform4fv(r.style, style || material); gl.uniform1f(r.mode, mode || 0);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    function box(p, size, color, style, shape) { draw(model(p, size), color, shape || 'box', style); }
    function ball(p, diameter, color, style) { box(p,[diameter,diameter,diameter],color,style,'sphere'); }
    function tube(a,b,diameter,color,style) { draw(bone(a,b,diameter),color,'cylinder',style); }
    function shadow(p, size, opacity) {
      gl.depthMask(false); draw(model(p,[size[0],size[1],1]),[.004,.006,.012],'plane',[opacity,1,0,0],1); gl.depthMask(true);
    }
    // Low, precision-milled work surface with a restrained perimeter reveal.
    draw(model([0,0,-.28],[30,30,1]),[0,0,0],'plane',matte,2);
    shadow([0,0,-.276],[4.5,3.4],.55);
    // Compact lab furniture frames the task without enclosing the camera.
    // These are visual set pieces, not simulated collision geometry.
    box([0,1.17,-.14],[3.36,.22,.19],[.065,.079,.11],matte,'slab');
    [-1,1].forEach(function(side){
      var color=side<0?cyan:purple;
      shadow([side*1.63,1.11,-.275],[.48,.42],.35);
      box([side*1.63,1.11,-.055],[.12,.14,.45],graphite,matte);
      box([side*1.63,1.095,.25],[.075,.082,.27],titanium,material);
      box([side*1.63,1.048,.25],[.018,.005,.20],color,[1,40,.05,1.5],'slab');
      box([side*1.63,1.11,.40],[.14,.18,.035],graphite,matte);
    });
    box([0,1.05,-.085],[1.1,.006,.009],[.36,.43,.56],accent,'slab');
    box([0,0,-.197],[2.88,1.79,.12],[.025,.032,.047],matte,'slab');
    box([0,0,-.106],[3.16,2.04,.196],[.135,.15,.192],matte,'slab');
    box([0,0,-.025],[3.11,1.99,.05],[.19,.207,.249],matte,'slab');
    // Short accent inlay, kept below the task plane.
    box([.70,-1.017,-.12],[.58,.004,.008],cyan,accent,'slab');
    box([1.04,-1.017,-.12],[.08,.004,.008],purple,accent,'slab');
    // Three tiny task lamps show completed deliveries in the scene itself.
    for(var lamp=0;!sensor && lamp<state.objects.length;lamp++){
      var lampColor=lamp<state.delivered?mint:lamp===state.delivered?cyan:graphite;
      box([-.97+lamp*.105,-1.019,-.105],[.065,.009,.016],lampColor,
        [1,40,.05,lamp<state.delivered?.45:lamp===state.delivered?.10+pulse*.12:0],'slab');
    }
    // Subdued Cartesian grid, physically coplanar with the task surface.
    for (var x=-1.4;x<=1.41;x+=.2) box([x,0,.0011],[.0017,1.78,.0018],[.235,.252,.287],matte,'slab');
    for (var y=-.8;y<=.81;y+=.2) box([0,y,.0012],[2.88,.0017,.0018],[.235,.252,.287],matte,'slab');
    state.obstacles.forEach(function(o){
      if(o.dynamic){
        for(var mark=-.5;mark<=.501;mark+=.125){
          box([o.position[0],mark,.004],[.008,.025,.002],[.20,.18,.30],matte,'slab');
        }
      }
    });
    // Colored pickup pads guide the eye to the few objects that matter.
    var nextObject=null,nextDistance=Infinity;
    state.objects.forEach(function(o){
      if(!o.delivered && state.robot.carrying==null){var d=distance(o.position,state.robot.position);if(d<nextDistance){nextObject=o;nextDistance=d;}}
      if(!sensor && !o.delivered && state.robot.carrying!==state.objects.indexOf(o)){
        var padColor=o.color.map(function(v){return v*.28;});
        box([o.position[0],o.position[1],.0038],[.255,.255,.003],padColor,matte,'slab');
        box([o.position[0],o.position[1]-.137,.005],[.065,.009,.004],o.color,accent,'slab');
      }
    });
    // Softer, broad occlusion plus tight contacts make heights readable.
    shadow([-1.43,0,.004],[.59,.53],.65);
    state.obstacles.forEach(function(o){shadow([o.position[0]+.025,o.position[1]+.028,.004],[o.size[0]*2.3,o.size[1]*2.3],.48);});
    state.objects.forEach(function(o){var lift=Math.max(0,o.position[2]-.08);shadow([o.position[0]+lift*.14,o.position[1]+lift*.1,.004],[.27+lift*.36,.27+lift*.36],.54/(1+lift*2));});
    var gp=state.goal.position, gs=state.goal.size;
    shadow([gp[0],gp[1],.004],[gs[0]*1.5,gs[1]*1.5],.44);
    // Open receiving tray: clear destination accent and graphite walls.
    box([gp[0],gp[1],.012],[gs[0]+.025,gs[1]+.025,.024],[.13,.20,.215],matte);
    box([gp[0],gp[1],.026],[gs[0]-.052,gs[1]-.052,.01],[.095,.16,.168],matte);
    box([gp[0]-gs[0]/2,gp[1],.063],[.027,gs[1],.126],titanium,matte);
    box([gp[0]+gs[0]/2,gp[1],.063],[.027,gs[1],.126],titanium,matte);
    box([gp[0],gp[1]-gs[1]/2,.038],[gs[0],.027,.076],titanium,matte);
    box([gp[0],gp[1]+gs[1]/2,.063],[gs[0],.027,.126],titanium,matte);
    box([gp[0],gp[1]-gs[1]/2-.014,.052],[gs[0]*.63,.004,.009],goalColor,[1,52,.11,.4],'slab');
    for(var slot=0;slot<3;slot++){
      box([gp[0]-.13+slot*.13,gp[1]-.15,.034],[.047,.016,.006],
        slot<state.delivered?mint:[.19,.28,.31],slot<state.delivered?accent:matte,'slab');
    }
    if(!sensor && (state.robot.carrying!=null || state.success)){
      gl.depthMask(false);
      var goalHalo=.68+(state.success?.05*pulse:0);
      draw(model([gp[0],gp[1],.006],[goalHalo,goalHalo,1]),goalColor,'ring',[.27+pulse*.08,35,0,.42]);
      if(state.success)draw(model([gp[0],gp[1],.007],[.85+pulse*.1,.85+pulse*.1,1]),mint,'ring',[.11+(1-pulse)*.09,35,0,.5]);
      gl.depthMask(true);
    }
    if(!sensor && nextObject && !state.done){
      gl.depthMask(false);
      draw(model([nextObject.position[0],nextObject.position[1],.006],[.33,.33,1]),nextObject.color,'ring',[.32+pulse*.08,40,0,.35]);
      gl.depthMask(true);
    }
    if(!sensor && state.targetShifted && state.challengeEvents.length && state.time-state.challengeEvents[0].time<3){
      var shiftedFrom=state.challengeEvents[0].from;
      gl.depthMask(false);
      draw(model([shiftedFrom[0],shiftedFrom[1],.006],[.58,.58,1]),purple,'ring',[(3-(state.time-state.challengeEvents[0].time))*.11,35,0,.3]);
      gl.depthMask(true);
    }
    state.obstacles.forEach(function(o){
      var color=o.dynamic?[.39,.32,.58]:[.36,.39,.46];box(o.position,o.size,color,matte);
      box([o.position[0],o.position[1],o.position[2]+o.size[2]/2+.002],[o.size[0]*.48,o.size[1]*.48,.003],o.dynamic?purple:[.51,.55,.61],accent);
      if(o.dynamic){
        draw(model([o.position[0],o.position[1],.007],[.33,.33,1]),purple,'ring',[.4,42,0,.15]);
      }
    });
    state.objects.forEach(function(o){
      box(o.position,o.size,o.color,[1,58,.13,0]);
      // Small precision inlay identifies the grasp face without visual clutter.
      box([o.position[0],o.position[1],o.position[2]+o.size[2]/2+.001],[o.size[0]*.34,o.size[1]*.34,.002],o.color.map(function(v){return v*.58;}),matte);
    });
    // Equal-length links form a planar inverse-kinematic visual chain.
    var shoulder=[-1.43,0,.32], ee=state.robot.position, wrist=add(ee,[0,0,.14]);
    var delta=sub(wrist,shoulder),unit=norm(delta),middle=mul(add(shoulder,wrist),.5);
    var perpendicular=norm(sub([0,0,1],mul(unit,unit[2])));
    var elbow=add(middle,mul(perpendicular,Math.sqrt(Math.max(.001,1.5*1.5-dot(delta,delta)/4))));
    box([-1.43,0,.047],[.32,.35,.094],graphite,material,'cylinder');
    box([-1.43,0,.118],[.245,.245,.11],pearl,material,'cylinder');
    box([-1.43,0,.176],[.24,.24,.018],cyan,accent,'cylinder');
    tube([-1.43,0,.18],shoulder,.17,titanium);
    tube(shoulder,elbow,.145,pearl); tube(elbow,wrist,.115,pearl);
    var axis=norm(cross(sub(elbow,shoulder),sub(wrist,elbow))); if(length(axis)<.1)axis=[0,1,0];
    function joint(p,diameter,depth,color){
      ball(p,diameter*.92,graphite);tube(add(p,mul(axis,-depth/2)),add(p,mul(axis,depth/2)),diameter,pearl);
      tube(add(p,mul(axis,-depth/2-.006)),add(p,mul(axis,-depth/2-.012)),diameter*.68,titanium);
      tube(add(p,mul(axis,depth/2+.006)),add(p,mul(axis,depth/2+.012)),diameter*.68,titanium);
      tube(add(p,mul(axis,-depth/2-.013)),add(p,mul(axis,-depth/2-.018)),diameter*.3,color,accent);
      tube(add(p,mul(axis,depth/2+.013)),add(p,mul(axis,depth/2+.018)),diameter*.3,color,accent);
    }
    joint(shoulder,.225,.18,cyan);joint(elbow,.194,.155,purple);
    ball(wrist,.145,titanium);tube(wrist,add(ee,[0,0,.062]),.106,pearl);
    box([ee[0],ee[1],ee[2]+.055],[.16,.09,.055],graphite,material);
    var opening=state.robot.carrying==null?.12:.08;
    box([ee[0]-opening/2,ee[1],ee[2]],[.026,.075,.115],pearl,material);
    box([ee[0]+opening/2,ee[1],ee[2]],[.026,.075,.115],pearl,material);
    box([ee[0]-opening/2+.012,ee[1],ee[2]-.023],[.006,.052,.036],graphite,matte);
    box([ee[0]+opening/2-.012,ee[1],ee[2]-.023],[.006,.052,.036],graphite,matte);
    ball([ee[0],ee[1]-.048,ee[2]+.058],.018,cyan,accent);
    // Target halo and a fine spatial trail support replay without covering tasks.
    if(!sensor && view.showTarget!==false){
      var tp=state.robot.target;
      draw(model([tp[0],tp[1],Math.max(.009,tp[2])],[.12,.12,1]),mint,'ring',[.65,40,0,.15]);
      draw(model([tp[0],tp[1],.008],[.12,.12,1]),mint,'ring',[.25,40,0,.05]);
      if(distance(tp,state.robot.position)>.04){
        gl.depthMask(false);
        for(var tick=0;tick<4;tick++){
          var tickAngle=tick*Math.PI*.5;
          box([tp[0]+Math.cos(tickAngle)*.095,tp[1]+Math.sin(tickAngle)*.095,Math.max(.012,tp[2])],
            [.012,.012,.012],mint,[.65,35,0,.3]);
        }
        gl.depthMask(true);
      }
    }
    if(!sensor && view.showTrail){
      gl.depthMask(false);
      for(var t=Math.max(0,state.trace.length-90);t<state.trace.length;t+=4){
        var fade=(t-Math.max(0,state.trace.length-90))/90;
        ball(state.trace[t].position,.012,cyan,[.12+fade*.35,32,0,.1]);
      }gl.depthMask(true);
    }
    return { ok: true, width: w, height: h, mode: 'webgl-3d',
      challenge: state.opts && state.opts.challenge || 'starter', lighting: night ? 'night' : 'studio',
      targetShifted: !!state.targetShifted,
      camera: sensor ? { id: SENSOR_CAMERA.id, eye: eye.slice(), target: target.slice(),
        fovY: SENSOR_CAMERA.fovY, width: w, height: h, coordinates: 'z-up',
        source: 'bounded-demo', overlays: false } : { id: 'spectator', eye: eye.slice(), target: target.slice(),
        fovY: 0.76, width: w, height: h, coordinates: 'z-up', source: 'bounded-demo', overlays: true } };
  }

  function render(canvas, state, view) { return renderScene(canvas, state, view, false); }
  function renderSensor(canvas, state, options) {
    options = options || {};
    var width = options.width === undefined ? 256 : options.width;
    var height = options.height === undefined ? 256 : options.height;
    if (![width, height].every(function (n) { return Number.isInteger(n) && n >= 64 && n <= 2048; })) {
      return { ok: false, reason: 'invalid-sensor-size', detail: 'Sensor width and height must be integers from 64 to 2048.' };
    }
    return renderScene(canvas, state, { width: width, height: height }, true);
  }

  root.BrainArena3D = Object.freeze({ create: create, step: step, demoAction: demoAction,
    render: render, renderSensor: renderSensor });
})(typeof globalThis !== 'undefined' ? globalThis : this);
