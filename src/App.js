import React, { useRef, useEffect, useLayoutEffect, useState } from "react";
import './App.css';
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
  useMotionValue,
  useVelocity,
  useAnimationFrame,
} from "framer-motion";
import { section } from "framer-motion/client";
import emailjs from '@emailjs/browser';

function SplashCursor({
  SIM_RESOLUTION = 128,
  DYE_RESOLUTION = 1440,
  CAPTURE_RESOLUTION = 512,
  DENSITY_DISSIPATION = 3.5,
  VELOCITY_DISSIPATION = 2,
  PRESSURE = 0.1,
  PRESSURE_ITERATIONS = 20,
  CURL = 3,
  SPLAT_RADIUS = 0.2,
  SPLAT_FORCE = 6000,
  SHADING = true,
  COLOR_UPDATE_SPEED = 10,
  BACK_COLOR = { r: 0.5, g: 0, b: 0 },
  TRANSPARENT = true
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function pointerPrototype() {
      this.id = -1;
      this.texcoordX = 0;
      this.texcoordY = 0;
      this.prevTexcoordX = 0;
      this.prevTexcoordY = 0;
      this.deltaX = 0;
      this.deltaY = 0;
      this.down = false;
      this.moved = false;
      this.color = [0, 0, 0];
    }

    let config = {
      SIM_RESOLUTION,
      DYE_RESOLUTION,
      CAPTURE_RESOLUTION,
      DENSITY_DISSIPATION,
      VELOCITY_DISSIPATION,
      PRESSURE,
      PRESSURE_ITERATIONS,
      CURL,
      SPLAT_RADIUS,
      SPLAT_FORCE,
      SHADING,
      COLOR_UPDATE_SPEED,
      PAUSED: false,
      BACK_COLOR,
      TRANSPARENT,
    };

    let pointers = [new pointerPrototype()];

    const { gl, ext } = getWebGLContext(canvas);
    if (!ext.supportLinearFiltering) {
      config.DYE_RESOLUTION = 256;
      config.SHADING = false;
    }

    function getWebGLContext(canvas) {
      const params = {
        alpha: true,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false,
      };
      let gl = canvas.getContext('webgl2', params);
      const isWebGL2 = !!gl;
      if (!isWebGL2)
        gl =
          canvas.getContext('webgl', params) ||
          canvas.getContext('experimental-webgl', params);

      let halfFloat;
      let supportLinearFiltering;
      if (isWebGL2) {
        gl.getExtension('EXT_color_buffer_float');
        supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
      } else {
        halfFloat = gl.getExtension('OES_texture_half_float');
        supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
      }
      gl.clearColor(0.0, 0.0, 0.0, 1.0);

      const halfFloatTexType = isWebGL2
        ? gl.HALF_FLOAT
        : halfFloat && halfFloat.HALF_FLOAT_OES;
      let formatRGBA;
      let formatRG;
      let formatR;

      if (isWebGL2) {
        formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
      } else {
        formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
      }

      return {
        gl,
        ext: {
          formatRGBA,
          formatRG,
          formatR,
          halfFloatTexType,
          supportLinearFiltering,
        },
      };
    }

    function getSupportedFormat(gl, internalFormat, format, type) {
      if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
        switch (internalFormat) {
          case gl.R16F:
            return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
          case gl.RG16F:
            return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
          default:
            return null;
        }
      }
      return { internalFormat, format };
    }

    function supportRenderTextureFormat(gl, internalFormat, format, type) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0
      );
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      return status === gl.FRAMEBUFFER_COMPLETE;
    }

    class Material {
      constructor(vertexShader, fragmentShaderSource) {
        this.vertexShader = vertexShader;
        this.fragmentShaderSource = fragmentShaderSource;
        this.programs = [];
        this.activeProgram = null;
        this.uniforms = [];
      }
      setKeywords(keywords) {
        let hash = 0;
        for (let i = 0; i < keywords.length; i++) hash += hashCode(keywords[i]);
        let program = this.programs[hash];
        if (program == null) {
          let fragmentShader = compileShader(
            gl.FRAGMENT_SHADER,
            this.fragmentShaderSource,
            keywords
          );
          program = createProgram(this.vertexShader, fragmentShader);
          this.programs[hash] = program;
        }
        if (program === this.activeProgram) return;
        this.uniforms = getUniforms(program);
        this.activeProgram = program;
      }
      bind() {
        gl.useProgram(this.activeProgram);
      }
    }

    class Program {
      constructor(vertexShader, fragmentShader) {
        this.uniforms = {};
        this.program = createProgram(vertexShader, fragmentShader);
        this.uniforms = getUniforms(this.program);
      }
      bind() {
        gl.useProgram(this.program);
      }
    }

    function createProgram(vertexShader, fragmentShader) {
      let program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        console.trace(gl.getProgramInfoLog(program));
      return program;
    }

    function getUniforms(program) {
      let uniforms = [];
      let uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < uniformCount; i++) {
        let uniformName = gl.getActiveUniform(program, i).name;
        uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
      }
      return uniforms;
    }

    function compileShader(type, source, keywords) {
      source = addKeywords(source, keywords);
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        console.trace(gl.getShaderInfoLog(shader));
      return shader;
    }

    function addKeywords(source, keywords) {
      if (!keywords) return source;
      let keywordsString = '';
      keywords.forEach((keyword) => {
        keywordsString += '#define ' + keyword + '\n';
      });
      return keywordsString + source;
    }

    const baseVertexShader = compileShader(
      gl.VERTEX_SHADER,
      `
        precision highp float;
        attribute vec2 aPosition;
        varying vec2 vUv;
        varying vec2 vL;
        varying vec2 vR;
        varying vec2 vT;
        varying vec2 vB;
        uniform vec2 texelSize;

        void main () {
            vUv = aPosition * 0.5 + 0.5;
            vL = vUv - vec2(texelSize.x, 0.0);
            vR = vUv + vec2(texelSize.x, 0.0);
            vT = vUv + vec2(0.0, texelSize.y);
            vB = vUv - vec2(0.0, texelSize.y);
            gl_Position = vec4(aPosition, 0.0, 1.0);
        }
      `
    );

    const copyShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        uniform sampler2D uTexture;

        void main () {
            gl_FragColor = texture2D(uTexture, vUv);
        }
      `
    );

    const clearShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        uniform sampler2D uTexture;
        uniform float value;

        void main () {
            gl_FragColor = value * texture2D(uTexture, vUv);
        }
      `
    );

    const displayShaderSource = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uTexture;
      uniform sampler2D uDithering;
      uniform vec2 ditherScale;
      uniform vec2 texelSize;

      vec3 linearToGamma (vec3 color) {
          color = max(color, vec3(0));
          return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));
      }

      void main () {
          vec3 c = texture2D(uTexture, vUv).rgb;
          #ifdef SHADING
              vec3 lc = texture2D(uTexture, vL).rgb;
              vec3 rc = texture2D(uTexture, vR).rgb;
              vec3 tc = texture2D(uTexture, vT).rgb;
              vec3 bc = texture2D(uTexture, vB).rgb;

              float dx = length(rc) - length(lc);
              float dy = length(tc) - length(bc);

              vec3 n = normalize(vec3(dx, dy, length(texelSize)));
              vec3 l = vec3(0.0, 0.0, 1.0);

              float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
              c *= diffuse;
          #endif

          float a = max(c.r, max(c.g, c.b));
          gl_FragColor = vec4(c, a);
      }
    `;

    const splatShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision highp float;
        precision highp sampler2D;
        varying vec2 vUv;
        uniform sampler2D uTarget;
        uniform float aspectRatio;
        uniform vec3 color;
        uniform vec2 point;
        uniform float radius;

        void main () {
            vec2 p = vUv - point.xy;
            p.x *= aspectRatio;
            vec3 splat = exp(-dot(p, p) / radius) * color;
            vec3 base = texture2D(uTarget, vUv).xyz;
            gl_FragColor = vec4(base + splat, 1.0);
        }
      `
    );

    const advectionShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision highp float;
        precision highp sampler2D;
        varying vec2 vUv;
        uniform sampler2D uVelocity;
        uniform sampler2D uSource;
        uniform vec2 texelSize;
        uniform vec2 dyeTexelSize;
        uniform float dt;
        uniform float dissipation;

        vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
            vec2 st = uv / tsize - 0.5;
            vec2 iuv = floor(st);
            vec2 fuv = fract(st);

            vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
            vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
            vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
            vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);

            return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
        }

        void main () {
            #ifdef MANUAL_FILTERING
                vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
                vec4 result = bilerp(uSource, coord, dyeTexelSize);
            #else
                vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
                vec4 result = texture2D(uSource, coord);
            #endif
            float decay = 1.0 + dissipation * dt;
            gl_FragColor = result / decay;
        }
      `,
      ext.supportLinearFiltering ? null : ['MANUAL_FILTERING']
    );

    const divergenceShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uVelocity;

        void main () {
            float L = texture2D(uVelocity, vL).x;
            float R = texture2D(uVelocity, vR).x;
            float T = texture2D(uVelocity, vT).y;
            float B = texture2D(uVelocity, vB).y;

            vec2 C = texture2D(uVelocity, vUv).xy;
            if (vL.x < 0.0) { L = -C.x; }
            if (vR.x > 1.0) { R = -C.x; }
            if (vT.y > 1.0) { T = -C.y; }
            if (vB.y < 0.0) { B = -C.y; }

            float div = 0.5 * (R - L + T - B);
            gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
        }
      `
    );

    const curlShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uVelocity;

        void main () {
            float L = texture2D(uVelocity, vL).y;
            float R = texture2D(uVelocity, vR).y;
            float T = texture2D(uVelocity, vT).x;
            float B = texture2D(uVelocity, vB).x;
            float vorticity = R - L - T + B;
            gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
        }
      `
    );

    const vorticityShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision highp float;
        precision highp sampler2D;
        varying vec2 vUv;
        varying vec2 vL;
        varying vec2 vR;
        varying vec2 vT;
        varying vec2 vB;
        uniform sampler2D uVelocity;
        uniform sampler2D uCurl;
        uniform float curl;
        uniform float dt;

        void main () {
            float L = texture2D(uCurl, vL).x;
            float R = texture2D(uCurl, vR).x;
            float T = texture2D(uCurl, vT).x;
            float B = texture2D(uCurl, vB).x;
            float C = texture2D(uCurl, vUv).x;

            vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
            force /= length(force) + 0.0001;
            force *= curl * C;
            force.y *= -1.0;

            vec2 velocity = texture2D(uVelocity, vUv).xy;
            velocity += force * dt;
            velocity = min(max(velocity, -1000.0), 1000.0);
            gl_FragColor = vec4(velocity, 0.0, 1.0);
        }
      `
    );

    const pressureShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uPressure;
        uniform sampler2D uDivergence;

        void main () {
            float L = texture2D(uPressure, vL).x;
            float R = texture2D(uPressure, vR).x;
            float T = texture2D(uPressure, vT).x;
            float B = texture2D(uPressure, vB).x;
            float C = texture2D(uPressure, vUv).x;
            float divergence = texture2D(uDivergence, vUv).x;
            float pressure = (L + R + B + T - divergence) * 0.25;
            gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
        }
      `
    );

    const gradientSubtractShader = compileShader(
      gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uPressure;
        uniform sampler2D uVelocity;

        void main () {
            float L = texture2D(uPressure, vL).x;
            float R = texture2D(uPressure, vR).x;
            float T = texture2D(uPressure, vT).x;
            float B = texture2D(uPressure, vB).x;
            vec2 velocity = texture2D(uVelocity, vUv).xy;
            velocity.xy -= vec2(R - L, T - B);
            gl_FragColor = vec4(velocity, 0.0, 1.0);
        }
      `
    );

    const blit = (() => {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]),
        gl.STATIC_DRAW
      );
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        new Uint16Array([0, 1, 2, 0, 2, 3]),
        gl.STATIC_DRAW
      );
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(0);
      return (target, clear = false) => {
        if (target == null) {
          gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        } else {
          gl.viewport(0, 0, target.width, target.height);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }
        if (clear) {
          gl.clearColor(0.0, 0.0, 0.0, 1.0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      };
    })();

    let dye, velocity, divergence, curl, pressure;

    const copyProgram = new Program(baseVertexShader, copyShader);
    const clearProgram = new Program(baseVertexShader, clearShader);
    const splatProgram = new Program(baseVertexShader, splatShader);
    const advectionProgram = new Program(baseVertexShader, advectionShader);
    const divergenceProgram = new Program(baseVertexShader, divergenceShader);
    const curlProgram = new Program(baseVertexShader, curlShader);
    const vorticityProgram = new Program(baseVertexShader, vorticityShader);
    const pressureProgram = new Program(baseVertexShader, pressureShader);
    const gradienSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);
    const displayMaterial = new Material(baseVertexShader, displayShaderSource);

    function initFramebuffers() {
      let simRes = getResolution(config.SIM_RESOLUTION);
      let dyeRes = getResolution(config.DYE_RESOLUTION);
      const texType = ext.halfFloatTexType;
      const rgba = ext.formatRGBA;
      const rg = ext.formatRG;
      const r = ext.formatR;
      const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
      gl.disable(gl.BLEND);

      if (!dye)
        dye = createDoubleFBO(
          dyeRes.width,
          dyeRes.height,
          rgba.internalFormat,
          rgba.format,
          texType,
          filtering
        );
      else
        dye = resizeDoubleFBO(
          dye,
          dyeRes.width,
          dyeRes.height,
          rgba.internalFormat,
          rgba.format,
          texType,
          filtering
        );

      if (!velocity)
        velocity = createDoubleFBO(
          simRes.width,
          simRes.height,
          rg.internalFormat,
          rg.format,
          texType,
          filtering
        );
      else
        velocity = resizeDoubleFBO(
          velocity,
          simRes.width,
          simRes.height,
          rg.internalFormat,
          rg.format,
          texType,
          filtering
        );

      divergence = createFBO(
        simRes.width,
        simRes.height,
        r.internalFormat,
        r.format,
        texType,
        gl.NEAREST
      );
      curl = createFBO(
        simRes.width,
        simRes.height,
        r.internalFormat,
        r.format,
        texType,
        gl.NEAREST
      );
      pressure = createDoubleFBO(
        simRes.width,
        simRes.height,
        r.internalFormat,
        r.format,
        texType,
        gl.NEAREST
      );
    }

    function createFBO(w, h, internalFormat, format, type, param) {
      gl.activeTexture(gl.TEXTURE0);
      let texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

      let fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0
      );
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);

      let texelSizeX = 1.0 / w;
      let texelSizeY = 1.0 / h;
      return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX,
        texelSizeY,
        attach(id) {
          gl.activeTexture(gl.TEXTURE0 + id);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          return id;
        },
      };
    }

    function createDoubleFBO(w, h, internalFormat, format, type, param) {
      let fbo1 = createFBO(w, h, internalFormat, format, type, param);
      let fbo2 = createFBO(w, h, internalFormat, format, type, param);
      return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        get read() {
          return fbo1;
        },
        set read(value) {
          fbo1 = value;
        },
        get write() {
          return fbo2;
        },
        set write(value) {
          fbo2 = value;
        },
        swap() {
          let temp = fbo1;
          fbo1 = fbo2;
          fbo2 = temp;
        },
      };
    }

    function resizeFBO(target, w, h, internalFormat, format, type, param) {
      let newFBO = createFBO(w, h, internalFormat, format, type, param);
      copyProgram.bind();
      gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
      blit(newFBO);
      return newFBO;
    }

    function resizeDoubleFBO(target, w, h, internalFormat, format, type, param) {
      if (target.width === w && target.height === h) return target;
      target.read = resizeFBO(
        target.read,
        w,
        h,
        internalFormat,
        format,
        type,
        param
      );
      target.write = createFBO(w, h, internalFormat, format, type, param);
      target.width = w;
      target.height = h;
      target.texelSizeX = 1.0 / w;
      target.texelSizeY = 1.0 / h;
      return target;
    }

    function updateKeywords() {
      let displayKeywords = [];
      if (config.SHADING) displayKeywords.push('SHADING');
      displayMaterial.setKeywords(displayKeywords);
    }

    updateKeywords();
    initFramebuffers();
    let lastUpdateTime = Date.now();
    let colorUpdateTimer = 0.0;

    function updateFrame() {
      const dt = calcDeltaTime();
      if (resizeCanvas()) initFramebuffers();
      updateColors(dt);
      applyInputs();
      step(dt);
      render(null);
      requestAnimationFrame(updateFrame);
    }

    function calcDeltaTime() {
      let now = Date.now();
      let dt = (now - lastUpdateTime) / 1000;
      dt = Math.min(dt, 0.016666);
      lastUpdateTime = now;
      return dt;
    }

    function resizeCanvas() {
      let width = scaleByPixelRatio(canvas.clientWidth);
      let height = scaleByPixelRatio(canvas.clientHeight);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        return true;
      }
      return false;
    }

    function updateColors(dt) {
      colorUpdateTimer += dt * config.COLOR_UPDATE_SPEED;
      if (colorUpdateTimer >= 1) {
        colorUpdateTimer = wrap(colorUpdateTimer, 0, 1);
        pointers.forEach((p) => {
          p.color = generateColor();
        });
      }
    }

    function applyInputs() {
      pointers.forEach((p) => {
        if (p.moved) {
          p.moved = false;
          splatPointer(p);
        }
      });
    }

    function step(dt) {
      gl.disable(gl.BLEND);
      curlProgram.bind();
      gl.uniform2f(
        curlProgram.uniforms.texelSize,
        velocity.texelSizeX,
        velocity.texelSizeY
      );
      gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
      blit(curl);

      vorticityProgram.bind();
      gl.uniform2f(
        vorticityProgram.uniforms.texelSize,
        velocity.texelSizeX,
        velocity.texelSizeY
      );
      gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
      gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
      gl.uniform1f(vorticityProgram.uniforms.dt, dt);
      blit(velocity.write);
      velocity.swap();

      divergenceProgram.bind();
      gl.uniform2f(
        divergenceProgram.uniforms.texelSize,
        velocity.texelSizeX,
        velocity.texelSizeY
      );
      gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
      blit(divergence);

      clearProgram.bind();
      gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
      gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
      blit(pressure.write);
      pressure.swap();

      pressureProgram.bind();
      gl.uniform2f(
        pressureProgram.uniforms.texelSize,
        velocity.texelSizeX,
        velocity.texelSizeY
      );
      gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
      for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
        blit(pressure.write);
        pressure.swap();
      }

      gradienSubtractProgram.bind();
      gl.uniform2f(
        gradienSubtractProgram.uniforms.texelSize,
        velocity.texelSizeX,
        velocity.texelSizeY
      );
      gl.uniform1i(
        gradienSubtractProgram.uniforms.uPressure,
        pressure.read.attach(0)
      );
      gl.uniform1i(
        gradienSubtractProgram.uniforms.uVelocity,
        velocity.read.attach(1)
      );
      blit(velocity.write);
      velocity.swap();

      advectionProgram.bind();
      gl.uniform2f(
        advectionProgram.uniforms.texelSize,
        velocity.texelSizeX,
        velocity.texelSizeY
      );
      if (!ext.supportLinearFiltering)
        gl.uniform2f(
          advectionProgram.uniforms.dyeTexelSize,
          velocity.texelSizeX,
          velocity.texelSizeY
        );
      let velocityId = velocity.read.attach(0);
      gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
      gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
      gl.uniform1f(advectionProgram.uniforms.dt, dt);
      gl.uniform1f(
        advectionProgram.uniforms.dissipation,
        config.VELOCITY_DISSIPATION
      );
      blit(velocity.write);
      velocity.swap();

      if (!ext.supportLinearFiltering)
        gl.uniform2f(
          advectionProgram.uniforms.dyeTexelSize,
          dye.texelSizeX,
          dye.texelSizeY
        );
      gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
      gl.uniform1f(
        advectionProgram.uniforms.dissipation,
        config.DENSITY_DISSIPATION
      );
      blit(dye.write);
      dye.swap();
    }

    function render(target) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.BLEND);
      drawDisplay(target);
    }

    function drawDisplay(target) {
      let width = target == null ? gl.drawingBufferWidth : target.width;
      let height = target == null ? gl.drawingBufferHeight : target.height;
      displayMaterial.bind();
      if (config.SHADING)
        gl.uniform2f(displayMaterial.uniforms.texelSize, 1.0 / width, 1.0 / height);
      gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
      blit(target);
    }

    function splatPointer(pointer) {
      let dx = pointer.deltaX * config.SPLAT_FORCE;
      let dy = pointer.deltaY * config.SPLAT_FORCE;
      splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
    }

    function clickSplat(pointer) {
      const color = generateColor();
      color.r *= 10.0;
      color.g *= 10.0;
      color.b *= 10.0;
      let dx = 10 * (Math.random() - 0.5);
      let dy = 30 * (Math.random() - 0.5);
      splat(pointer.texcoordX, pointer.texcoordY, dx, dy, color);
    }

    function splat(x, y, dx, dy, color) {
      splatProgram.bind();
      gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
      gl.uniform1f(
        splatProgram.uniforms.aspectRatio,
        canvas.width / canvas.height
      );
      gl.uniform2f(splatProgram.uniforms.point, x, y);
      gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
      gl.uniform1f(
        splatProgram.uniforms.radius,
        correctRadius(config.SPLAT_RADIUS / 100.0)
      );
      blit(velocity.write);
      velocity.swap();

      gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
      gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
      blit(dye.write);
      dye.swap();
    }

    function correctRadius(radius) {
      let aspectRatio = canvas.width / canvas.height;
      if (aspectRatio > 1) radius *= aspectRatio;
      return radius;
    }

    function updatePointerDownData(pointer, id, posX, posY) {
      pointer.id = id;
      pointer.down = true;
      pointer.moved = false;
      pointer.texcoordX = posX / canvas.width;
      pointer.texcoordY = 1.0 - posY / canvas.height;
      pointer.prevTexcoordX = pointer.texcoordX;
      pointer.prevTexcoordY = pointer.texcoordY;
      pointer.deltaX = 0;
      pointer.deltaY = 0;
      pointer.color = generateColor();
    }

    function updatePointerMoveData(pointer, posX, posY, color) {
      pointer.prevTexcoordX = pointer.texcoordX;
      pointer.prevTexcoordY = pointer.texcoordY;
      pointer.texcoordX = posX / canvas.width;
      pointer.texcoordY = 1.0 - posY / canvas.height;
      pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
      pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
      pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
      pointer.color = color;
    }

    function updatePointerUpData(pointer) {
      pointer.down = false;
    }

    function correctDeltaX(delta) {
      let aspectRatio = canvas.width / canvas.height;
      if (aspectRatio < 1) delta *= aspectRatio;
      return delta;
    }

    function correctDeltaY(delta) {
      let aspectRatio = canvas.width / canvas.height;
      if (aspectRatio > 1) delta /= aspectRatio;
      return delta;
    }

    function generateColor() {
      let c = HSVtoRGB(Math.random(), 1.0, 1.0);
      c.r *= 0.15;
      c.g *= 0.15;
      c.b *= 0.15;
      return c;
    }

    function HSVtoRGB(h, s, v) {
      let r, g, b, i, f, p, q, t;
      i = Math.floor(h * 6);
      f = h * 6 - i;
      p = v * (1 - s);
      q = v * (1 - f * s);
      t = v * (1 - (1 - f) * s);
      switch (i % 6) {
        case 0:
          r = v;
          g = t;
          b = p;
          break;
        case 1:
          r = q;
          g = v;
          b = p;
          break;
        case 2:
          r = p;
          g = v;
          b = t;
          break;
        case 3:
          r = p;
          g = q;
          b = v;
          break;
        case 4:
          r = t;
          g = p;
          b = v;
          break;
        case 5:
          r = v;
          g = p;
          b = q;
          break;
        default:
          break;
      }
      return { r, g, b };
    }

    function wrap(value, min, max) {
      const range = max - min;
      if (range === 0) return min;
      return ((value - min) % range) + min;
    }

    function getResolution(resolution) {
      let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
      if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;
      const min = Math.round(resolution);
      const max = Math.round(resolution * aspectRatio);
      if (gl.drawingBufferWidth > gl.drawingBufferHeight)
        return { width: max, height: min };
      else return { width: min, height: max };
    }

    function scaleByPixelRatio(input) {
      const pixelRatio = window.devicePixelRatio || 1;
      return Math.floor(input * pixelRatio);
    }

    function hashCode(s) {
      if (s.length === 0) return 0;
      let hash = 0;
      for (let i = 0; i < s.length; i++) {
        hash = (hash << 5) - hash + s.charCodeAt(i);
        hash |= 0;
      }
      return hash;
    }

    window.addEventListener('mousedown', (e) => {
      let pointer = pointers[0];
      let posX = scaleByPixelRatio(e.clientX);
      let posY = scaleByPixelRatio(e.clientY);
      updatePointerDownData(pointer, -1, posX, posY);
      clickSplat(pointer);
    });

    document.body.addEventListener('mousemove', function handleFirstMouseMove(e) {
      let pointer = pointers[0];
      let posX = scaleByPixelRatio(e.clientX);
      let posY = scaleByPixelRatio(e.clientY);
      let color = generateColor();
      updateFrame();
      updatePointerMoveData(pointer, posX, posY, color);
      document.body.removeEventListener('mousemove', handleFirstMouseMove);
    });

    window.addEventListener('mousemove', (e) => {
      let pointer = pointers[0];
      let posX = scaleByPixelRatio(e.clientX);
      let posY = scaleByPixelRatio(e.clientY);
      let color = pointer.color;
      updatePointerMoveData(pointer, posX, posY, color);
    });

    document.body.addEventListener('touchstart', function handleFirstTouchStart(e) {
      const touches = e.targetTouches;
      let pointer = pointers[0];
      for (let i = 0; i < touches.length; i++) {
        let posX = scaleByPixelRatio(touches[i].clientX);
        let posY = scaleByPixelRatio(touches[i].clientY);
        updateFrame();
        updatePointerDownData(pointer, touches[i].identifier, posX, posY);
      }
      document.body.removeEventListener('touchstart', handleFirstTouchStart);
    });

    window.addEventListener('touchstart', (e) => {
      const touches = e.targetTouches;
      let pointer = pointers[0];
      for (let i = 0; i < touches.length; i++) {
        let posX = scaleByPixelRatio(touches[i].clientX);
        let posY = scaleByPixelRatio(touches[i].clientY);
        updatePointerDownData(pointer, touches[i].identifier, posX, posY);
      }
    });

    window.addEventListener(
      'touchmove',
      (e) => {
        const touches = e.targetTouches;
        let pointer = pointers[0];
        for (let i = 0; i < touches.length; i++) {
          let posX = scaleByPixelRatio(touches[i].clientX);
          let posY = scaleByPixelRatio(touches[i].clientY);
          updatePointerMoveData(pointer, posX, posY, pointer.color);
        }
      },
      false
    );

    window.addEventListener('touchend', (e) => {
      const touches = e.changedTouches;
      let pointer = pointers[0];
      for (let i = 0; i < touches.length; i++) {
        updatePointerUpData(pointer);
      }
    });

    updateFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    SIM_RESOLUTION,
    DYE_RESOLUTION,
    CAPTURE_RESOLUTION,
    DENSITY_DISSIPATION,
    VELOCITY_DISSIPATION,
    PRESSURE,
    PRESSURE_ITERATIONS,
    CURL,
    SPLAT_RADIUS,
    SPLAT_FORCE,
    SHADING,
    COLOR_UPDATE_SPEED,
    BACK_COLOR,
    TRANSPARENT,
  ]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 0, // set to 0 so it's the backest layer
        pointerEvents: 'none',
        width: '100%',
        height: '100%',
      }}
    >
      <canvas
        ref={canvasRef}
        id="fluid"
        style={{
          width: '100vw',
          height: '100vh',
          display: 'block',
        }}
      />
    </div>
  );
}

 

function useElementWidth(ref) {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    function updateWidth() {
      if (ref.current) {
        setWidth(ref.current.offsetWidth);
      }
    }
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [ref]);

  return width;
}

export const ScrollVelocity = ({
  scrollContainerRef,
  texts = [],
  velocity = 80,
  className = "",
  damping = 50,
  stiffness = 400,
  numCopies = 10,
  velocityMapping = { input: [0, 1000], output: [0, 10] },
  parallaxClassName = "parallax",
  scrollerClassName = "scroller",
  parallaxStyle,
  scrollerStyle,
}) => {
  function VelocityText({
    children,
    baseVelocity = velocity,
    scrollContainerRef,
    className = "",
    damping,
    stiffness,
    numCopies,
    velocityMapping,
    parallaxClassName,
    scrollerClassName,
    parallaxStyle,
    scrollerStyle,
  }) {
    const baseX = useMotionValue(0);
    const scrollOptions = scrollContainerRef ? { container: scrollContainerRef } : {};
    const { scrollY } = useScroll(scrollOptions);
    const scrollVelocity = useVelocity(scrollY);
    const smoothVelocity = useSpring(scrollVelocity, {
      damping: damping ?? 50,
      stiffness: stiffness ?? 400,
    });
    const velocityFactor = useTransform(
      smoothVelocity,
      velocityMapping?.input || [0, 1000],
      velocityMapping?.output || [0, 5],
      { clamp: false }
    );

    const copyRef = useRef(null);
    const copyWidth = useElementWidth(copyRef);

    function wrap(min, max, v) {
      const range = max - min;
      const mod = (((v - min) % range) + range) % range;
      return mod + min;
    }

    const x = useTransform(baseX, (v) => {
      if (copyWidth === 0) return "0px";
      return `${wrap(-copyWidth, 0, v)}px`;
    });

    const directionFactor = useRef(1);
    useAnimationFrame((t, delta) => {
      let moveBy = directionFactor.current * baseVelocity * (delta / 1000);

      if (velocityFactor.get() < 0) {
        directionFactor.current = -1;
      } else if (velocityFactor.get() > 0) {
        directionFactor.current = 1;
      }

      moveBy += directionFactor.current * moveBy * velocityFactor.get();
      baseX.set(baseX.get() + moveBy);
    });

    const spans = [];
    for (let i = 0; i < numCopies; i++) {
      spans.push(
        <span className={className} key={i} ref={i === 0 ? copyRef : null}>
          {children}
        </span>
      );
    }

    return (
      <div className={parallaxClassName} style={parallaxStyle}>
        <motion.div
          className={scrollerClassName}
          style={{ x, ...scrollerStyle }}
        >
          {spans}
        </motion.div>
      </div>
    );
  }

  return (
    <section>
      {texts.map((text, index) => (
        <VelocityText
          key={index}
          className={className}
          baseVelocity={index % 2 !== 0 ? -velocity : velocity}
          scrollContainerRef={scrollContainerRef}
          damping={damping}
          stiffness={stiffness}
          numCopies={numCopies}
          velocityMapping={velocityMapping}
          parallaxClassName={parallaxClassName}
          scrollerClassName={scrollerClassName}
          parallaxStyle={parallaxStyle}
          scrollerStyle={scrollerStyle}
        >
          {text}&nbsp;
        </VelocityText>
      ))}
    </section>
  );
};

const styles = {
  wrapper: {
    display: 'inline-block',
    whiteSpace: 'pre-wrap',
  },
  srOnly: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    border: 0,
  },
}

export function DecryptedText({
  text,
  speed = 120,
  maxIterations = 30,
  sequential = false,
  revealDirection = 'start',
  useOriginalCharsOnly = false,
  characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+',
  className = '',
  parentClassName = '',
  encryptedClassName = '',
  animateOn = 'hover',
  ...props
}) {
  const [displayText, setDisplayText] = useState(text);
  const [isHovering, setIsHovering] = useState(false);
  const [isScrambling, setIsScrambling] = useState(false);
  const [revealedIndices, setRevealedIndices] = useState(new Set());
  const [hasAnimated, setHasAnimated] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    let interval
    let currentIteration = 0

    const getNextIndex = (revealedSet) => {
      const textLength = text.length
      switch (revealDirection) {
        case 'start':
          return revealedSet.size
        case 'end':
          return textLength - 1 - revealedSet.size
        case 'center': {
          const middle = Math.floor(textLength / 2)
          const offset = Math.floor(revealedSet.size / 2)
          const nextIndex =
            revealedSet.size % 2 === 0
              ? middle + offset
              : middle - offset - 1

          if (nextIndex >= 0 && nextIndex < textLength && !revealedSet.has(nextIndex)) {
            return nextIndex
          }

          for (let i = 0; i < textLength; i++) {
            if (!revealedSet.has(i)) return i
          }
          return 0
        }
        default:
          return revealedSet.size
      }
    }

    const availableChars = useOriginalCharsOnly
      ? Array.from(new Set(text.split(''))).filter((char) => char !== ' ')
      : characters.split('')

    const shuffleText = (originalText, currentRevealed) => {
      if (useOriginalCharsOnly) {
        const positions = originalText.split('').map((char, i) => ({
          char,
          isSpace: char === ' ',
          index: i,
          isRevealed: currentRevealed.has(i),
        }))

        const nonSpaceChars = positions
          .filter((p) => !p.isSpace && !p.isRevealed)
          .map((p) => p.char)

        for (let i = nonSpaceChars.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
            ;[nonSpaceChars[i], nonSpaceChars[j]] = [nonSpaceChars[j], nonSpaceChars[i]]
        }

        let charIndex = 0
        return positions
          .map((p) => {
            if (p.isSpace) return ' '
            if (p.isRevealed) return originalText[p.index]
            return nonSpaceChars[charIndex++]
          })
          .join('')
      } else {
        return originalText
          .split('')
          .map((char, i) => {
            if (char === ' ') return ' '
            if (currentRevealed.has(i)) return originalText[i]
            return availableChars[Math.floor(Math.random() * availableChars.length)]
          })
          .join('')
      }
    }

    if (isHovering) {
      setIsScrambling(true)
      interval = setInterval(() => {
        setRevealedIndices((prevRevealed) => {
          if (sequential) {
            if (prevRevealed.size < text.length) {
              const nextIndex = getNextIndex(prevRevealed)
              const newRevealed = new Set(prevRevealed)
              newRevealed.add(nextIndex)
              setDisplayText(shuffleText(text, newRevealed))
              return newRevealed
            } else {
              clearInterval(interval)
              setIsScrambling(false)
              return prevRevealed
            }
          } else {
            setDisplayText(shuffleText(text, prevRevealed))
            currentIteration++
            if (currentIteration >= maxIterations) {
              clearInterval(interval)
              setIsScrambling(false)
              setDisplayText(text)
            }
            return prevRevealed
          }
        })
      }, speed)
    } else {
      setDisplayText(text)
      setRevealedIndices(new Set())
      setIsScrambling(false)
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [
    isHovering,
    text,
    speed,
    maxIterations,
    sequential,
    revealDirection,
    characters,
    useOriginalCharsOnly,
  ])

  useEffect(() => {
    if (animateOn !== 'view') return

    const observerCallback = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !hasAnimated) {
          setIsHovering(true)
          setHasAnimated(true)
        }
      })
    }

    const observerOptions = {
      root: null,
      rootMargin: '0px',
      threshold: 0.1,
    }

    const observer = new IntersectionObserver(observerCallback, observerOptions)
    const currentRef = containerRef.current
    if (currentRef) {
      observer.observe(currentRef)
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef)
      }
    }
  }, [animateOn, hasAnimated])

  const hoverProps =
    animateOn === 'hover'
      ? {
        onMouseEnter: () => setIsHovering(true),
        onMouseLeave: () => setIsHovering(false),
      }
      : {}

  return (
    <motion.span className={parentClassName} ref={containerRef} style={styles.wrapper} {...hoverProps} {...props}>
      <span style={styles.srOnly}>{displayText}</span>

      <span aria-hidden="true">
        {displayText.split('').map((char, index) => {
          const isRevealedOrDone =
            revealedIndices.has(index) || !isScrambling || !isHovering

          return (
            <span
              key={index}
              className={isRevealedOrDone ? className : encryptedClassName}
            >
              {char}
            </span>
          )
        })}
      </span>
    </motion.span>
  )
}





function Navbar() {
  const [menuOpen, setMenuOpen] = React.useState(false);

  // Close menu on navigation (for SPA smoothness)
  function handleNavClick() {
    setMenuOpen(false);
  }

  // Optional: close menu on resize to desktop
  React.useEffect(() => {
    function handleResize() {
      if (window.innerWidth > 600) setMenuOpen(false);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <nav className="navbar">
      <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
        <img src="/images/logo1.png" alt="Zelion Logo" />
      </div>
      <button
        className="menu-toggle"
        aria-label="Toggle menu"
        onClick={() => setMenuOpen((open) => !open)}
        style={{
          marginLeft: 'auto',
          marginRight: menuOpen ? '8px' : '0',
        }}
      >
        {menuOpen ? "✕" : "☰"}
      </button>
      <div className={`nav-links${menuOpen ? " open" : ""}`}>
        <a href="#home" onClick={handleNavClick}>Home</a>
        <a href="#about" onClick={handleNavClick}>About</a>
        <a href="#products" onClick={handleNavClick}>Products</a>
        <a href="#testimonials" onClick={handleNavClick}>Testimonials</a>
        <a href="#contact" className="contact-btn" onClick={handleNavClick}>Contact Us</a>
      </div>
    </nav>
  );
}


function Home() {
  // Scroll to products section on button click
  const handleExploreClick = (e) => {
    e.preventDefault();
    // Set hash first so browser jumps if needed
    window.location.hash = '#products';
    // Try to scroll smoothly if element exists
    const el = document.getElementById('products');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };


  return (
    <section
      id="home"
      className="home-section"
      style={{
        minHeight: '70vh', // reduced from 100vh
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        textAlign: 'center',
        padding: '0 8px', // reduced padding
        position: 'relative',
      }}
    >
      <div
        style={{
          borderRadius: '24px', // reduced radius
          padding: '28px 18px 24px 18px', // reduced padding
          maxWidth: '700px',
          margin: '0 auto',
          zIndex: 900,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <h1
          style={{
            fontSize: '3rem', // reduced font size
            fontWeight: 900,
            marginBottom: '8px', // reduced margin
            color: '#fff',
            letterSpacing: '1px',
            lineHeight: 1.08,
            textShadow: '0 2px 12px rgba(0,0,0,0.18), 0 1px 0 #007bff',
            zIndex: 900,
          }}
        >
          <span style={{ color: '#007bff', fontWeight: 900 }}>Zelion</span> Cricket
        </h1>
        <div
          style={{
            width: '40px', // reduced width
            height: '4px', // reduced height
            background: 'linear-gradient(90deg, #007bff 0%, #fff 100%)',
            borderRadius: '2px',
            margin: '0 auto 12px auto', // reduced margin
          }}
        />
        <p
          style={{
            fontSize: '1.6rem', // reduced font size
            color: '#e0e0e0',
            maxWidth: '520px',
            margin: '0 auto 10px auto', // reduced margin
            fontWeight: 500,
            zIndex: 900,
            textShadow: '0 1px 4px rgba(0,0,0,0.12)',
          }}
        >
          Your premier destination for <span style={{ color: '#ffd700', fontWeight: 700 }}>high-quality cricket balls</span> crafted for champions.
        </p>
        <p
          style={{
            fontSize: '0.95rem', // reduced font size
            color: '#b0c4de',
            margin: '0 auto 0 auto',
            maxWidth: '400px',
            zIndex: 900,
            letterSpacing: '0.1px',
          }}
        >
          Elevate your game with our hand-stitched, professional-grade cricket balls trusted by players worldwide.
        </p>
        <button
          href="#products"
          onClick={handleExploreClick}
          aria-label="Explore Products"
          type="button"
          style={{
            marginTop: '18px', // reduced margin
            padding: '0px 22px', // reduced padding
            borderRadius: '8px',
            background: 'linear-gradient(90deg, #007bff 60%, #00c6ff 100%)',
            color: '#fff',
            fontWeight: 700,
            fontSize: '1rem',
            textDecoration: 'none',
            boxShadow: '0 1px 6px rgba(0,123,255,0.18)',
            letterSpacing: '0.3px',
            transition: 'background 0.2s, transform 0.2s',
            display: 'inline-block',
            position: 'relative',
            overflow: 'visible',
            border: 'none',
            cursor: 'pointer'
          }}
          onMouseOver={e => e.currentTarget.style.transform = 'scale(1.04)'}
          onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          <span style={{ position: 'relative', zIndex: 2 }}>Explore Products</span>
        
        </button>
      </div>
    </section>
  );
}

function About() {
  return (
    <section id="about" style={{
      padding: '18px 0', // reduced padding
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      marginTop: '12px',
    }}>
      <h2 style={{ marginBottom: '12px',marginTop: '12px', zIndex: 900 }}>About Zelion Cricket</h2>
      <div style={{
        borderRadius: '16px',
        boxShadow: '0 4px 16px 0 rgba(31, 38, 135, 0.12)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        padding: '18px 12px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        maxWidth: '900px',
        width: '100%',
        gap: '20px',
        zIndex: 900
      }}>
        <div style={{
          flex: 1,
          fontSize: '1.1rem',
          color: '#fff',
          lineHeight: 1.7,
          textAlign: 'left',
          
        }}>
          <p>
            Zelion Cricket is dedicated to crafting the finest cricket balls for players at every level. Our journey began with a passion for the sport and a commitment to quality, innovation, and performance. Every Zelion ball is made from premium materials, hand-stitched by skilled artisans, and rigorously tested to meet the demands of both professional and amateur cricketers.
          </p>
          <p>
            We believe in supporting the cricketing community by providing products that enhance the game, whether it's for a test match, a day-night encounter, or a memorable keepsake. Our range includes traditional red balls, high-visibility white balls, and exclusive golden showpiece balls. At Zelion, we blend tradition with technology to deliver unmatched durability, swing, and consistency.
          </p>
          <p>
            Join thousands of players who trust Zelion for their cricketing needs. Experience the difference that passion and precision can make—experience Zelion Cricket.
          </p>
        </div>
        <div style={{
          flex: '0 0 220px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <img
            src="/images/logo2.png"
            alt="Zelion"
            style={{
              width: '260px',
              maxWidth: '200%',
              
            }}
            className="home-logo tilt-on-hover"
          />
        </div>
      </div>
    </section>
  );
}

function Products() {
  return (
    <section id="products" style={{
      padding: '18px 0', // reduced padding
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center'
    }}>
      <h2 style={{ marginBottom: '12px', zIndex: 900 }}>Our Cricket Products</h2>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px', // reduced gap
        justifyContent: 'center',
        maxWidth: '900px',
        zIndex: 900
      }}>
        <div style={{
          background: 'rgba(255,255,255,0.25)',
          borderRadius: '16px',
          padding: '24px',
          minWidth: '260px',
          maxWidth: '320px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <img src="/images/redball.png" alt="Zelion Red Ball" style={{ width: '170px', marginBottom: '12px' }} />
          <h3>Zelion Red Ball</h3>
          <p>Hand-stitched, premium leather, ideal for test matches and long innings.</p>
          <button
            style={{
              marginTop: '16px',
              padding: '10px 24px',
              borderRadius: '8px',
              border: 'none',
              background: 'rgba(0, 123, 255, 0.85)',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: '1rem',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
            }}
          >
            Buy Now
          </button>
        </div>
        <div style={{
          background: 'rgba(255,255,255,0.25)',
          borderRadius: '16px',
          padding: '24px',
          minWidth: '260px',
          maxWidth: '320px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <img src="/images/whiteball.png" alt="Zelion White Ball" style={{ width: '90px', marginBottom: '12px' }} />
          <h3>Zelion White Ball</h3>
          <p>Perfect for limited overs, great swing and visibility under lights.</p>
          <button
            style={{
              marginTop: '16px',
              padding: '10px 24px',
              borderRadius: '8px',
              border: 'none',
              background: 'rgba(0, 123, 255, 0.85)',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: '1rem',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
            }}
          >
            Buy Now
          </button>
        </div>
        <div style={{
          background: 'rgba(255,255,255,0.25)',
          borderRadius: '16px',
          padding: '24px',
          minWidth: '260px',
          maxWidth: '320px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <img src="/images/goldenball.png" alt="Zelion Golden Ball" style={{ width: '100px', marginBottom: '12px' }} />
          <h3>Zelion Golden Ball</h3>
          <p>Specially for keeping in house as a show piece, 24 carat gold is used.</p>
          <button
            style={{
              marginTop: '16px',
              padding: '10px 24px',
              borderRadius: '8px',
              border: 'none',
              background: 'rgba(0, 123, 255, 0.85)',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: '1rem',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
            }}
          >
            Buy Now
          </button>
        </div>
      </div>
    </section>
  );
}

function GallerySection() {
  return (
    <section
      id="gallery"
      className='gallery-section'
      style={{
        marginBottom: '0',
        padding: '8px 0', // add minimal padding
      }}
    >
      <img src="/images/test.png" alt="zelion" className='image' />
      <a href="http://zelioncricket.com" target='_blank' rel='noopener noreferrer'>
        <button className='gallery-button'>visit More</button>
      </a>
    </section>
  );
}

function Testimonials() {
  return (
    <section id="testimonials" style={{
      padding: '18px 0', // reduced padding
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center'
    }}>
      <h2 style={{ marginBottom: '12px' }}>What Players Say</h2>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px', // reduced gap
        justifyContent: 'center',
        maxWidth: '900px'
      }}>
        <div style={{
          background: 'rgba(255,255,255,0.25)',
          borderRadius: '16px',
          padding: '24px',
          minWidth: '260px',
          maxWidth: '320px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}>
          <p style={{ fontStyle: 'italic' }}>"Zelion balls changed the game for me!"</p>
          <div style={{ marginTop: '12px', fontWeight: 'bold' }}>- Pro Cricketer</div>
        </div>
        <div style={{
          background: 'rgba(255,255,255,0.25)',
          borderRadius: '16px',
          padding: '24px',
          minWidth: '260px',
          maxWidth: '320px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}>
          <p style={{ fontStyle: 'italic' }}>"Exceptional quality and swing. Highly recommended!"</p>
          <div style={{ marginTop: '12px', fontWeight: 'bold' }}>- A. Sharma</div>
        </div>
        <div style={{
          background: 'rgba(255,255,255,0.25)',
          borderRadius: '16px',
          padding: '24px',
          minWidth: '260px',
          maxWidth: '320px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}>
          <p style={{ fontStyle: 'italic' }}>"The durability is unmatched. Will buy again."</p>
          <div style={{ marginTop: '12px', fontWeight: 'bold' }}>- S. Patel</div>
        </div>
      </div>
    </section>
  );
}


function Contact() {
  return (
    <section
      id="contact"
      style={{
        minHeight: '60vh', // reduced minHeight
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(255,255,255,0.05)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        borderRadius: '18px',
        boxShadow: '0 4px 16px 0 rgba(31, 38, 135, 0.18)',
        padding: '18px 0', // reduced padding
        margin: '0',
        position: 'relative',
        zIndex: 1
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '900px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '12px 0', // reduced padding
          position: 'relative',
          zIndex: 2
        }}
      >
        <h2
          style={{
            fontSize: '1.6rem', // reduced font size
            fontWeight: 800,
            color: '#007bff',
            marginBottom: '18px', // reduced margin
            letterSpacing: '1px',
            textAlign: 'center'
          }}
        >
          Contact Us
        </h2>
        <div
          style={{
            width: '100%',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '12px', // reduced gap
          }}
        >
          {/* WhatsApp Live Chat */}
          <div
            style={{
              background: 'rgba(255,255,255,0.18)',
              borderRadius: '18px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              padding: '28px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '170px'
            }}
          >
            <h3 style={{ marginBottom: '12px', color: '#007bff', fontSize: '1.25rem', fontWeight: 700 }}>Live Chat</h3>
            <a
              href="https://wa.me/919876543210"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                background: '#25D366',
                color: '#fff',
                padding: '10px 20px',
                borderRadius: '10px',
                fontWeight: 'bold',
                fontSize: '1.08rem',
                textDecoration: 'none',
                boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
                gap: '10px'
              }}
            >
              Chat on WhatsApp
            </a>
          </div>
          {/* Location */}
          <div
            style={{
              background: 'rgba(255,255,255,0.18)',
              borderRadius: '18px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              padding: '28px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '170px'
            }}
          >
            <h3 style={{ marginBottom: '12px', color: '#007bff', fontSize: '1.25rem', fontWeight: 700 }}>Location</h3>
            <a
              href="https://maps.google.com/?q=Zelion+Cricket+Factory"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#fff',
                textDecoration: 'none',
                fontWeight: 'bold',
                fontSize: '1.08rem',
                textAlign: 'center'
              }}
            >
              Zelion Cricket Factory<br />
              123 Main Road, Bengaluru, India
            </a>
                                                                             </div>
          {/* Call Us */}
          <div
            style={{
              background: 'rgba(255,255,255,0.18)',
              borderRadius: '18px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              padding: '28px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '170px'
            }}
          >
            <h3 style={{ marginBottom: '12px', color: '#007bff', fontSize: '1.25rem', fontWeight: 700 }}>Call Us</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: '1.15rem',
                  fontWeight: 'bold',
                  color: '#fff',
                  userSelect: 'all',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  navigator.clipboard.writeText('+91 98765 43210');
                }}
                title="Click to copy"
              >
                +91 98765 43210
              </span>
              <button
                onClick={() => navigator.clipboard.writeText('+91 98765 43210')}
                style={{
                  marginLeft: 4,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#fff',
                  fontSize: '1.2rem'
                }}
                title="Copy number"
              >
                
              </button>
            </div>
          </div>
          {/* Email */}
          <div
            style={{
              background: 'rgba(255,255,255,0.18)',
              borderRadius: '18px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              padding: '28px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '170px'
            }}
          >
            <h3 style={{ marginBottom: '12px', color: '#007bff', fontSize: '1.25rem', fontWeight: 700 }}>Email</h3>
            <a
              href="mailto:info@zelioncricket.com"
              style={{
                color: '#fff',
                fontWeight: 'bold',
                fontSize: '1.08rem',
                textDecoration: 'none'
              }}
            >
              info@zelioncricket.com
            </a>
          </div>
          {/* Leave a Message (existing form) */}
          <div
            style={{
              background: 'rgba(255,255,255,0.18)',
              borderRadius: '18px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              padding: '28px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              minHeight: '180px',
              gridColumn: '1 / -1'
            }}
          >
            <h3 style={{ textAlign: 'center', marginBottom: '8px', color: '#007bff', fontWeight: 700, fontSize: '1.25rem' }}>Leave a Message</h3>
            <form
              style={{
                width: '100%',
                maxWidth: '420px',
                display: 'flex',
                flexDirection: 'column',
                gap: '18px',
              }}
              onSubmit={e => { e.preventDefault(); alert('Thank you for contacting us!'); }}
            >
              <input
                type="text"
                name="fullname"
                placeholder="Full Name"
                required
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.3)',
                  background: 'rgba(255,255,255,0.15)',
                  color: '#222',
                  fontSize: '1rem'
                }}
              />
              <input
                type="email"
                name="email"
                placeholder="Email Address"
                required
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.3)',
                  background: 'rgba(255,255,255,0.15)',
                  color: '#222',
                  fontSize: '1rem'
                }}
              />
              <textarea
                name="message"
                placeholder="Your Message"
                required
                rows={5}
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.3)',
                  background: 'rgba(255,255,255,0.15)',
                  color: '#222',
                  fontSize: '1rem',
                  resize: 'vertical'
                }}
              />
              <button
                type="submit"
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  border: 'none',
                  background: 'rgba(0, 123, 255, 0.7)',
                  color: '#fff',
                  fontWeight: 'bold',
                  fontSize: '1rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
                }}
              >
                Send Message
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer
      style={{
        width: '100%',
        textAlign: 'center',
        padding: '18px 0 10px 0',
        color: '#fff',
        fontSize: '1rem',
        background: 'rgba(0,0,0,0.18)',
        letterSpacing: '0.5px',
        marginTop: '32px'
      }}
    >
      &copy; {new Date().getFullYear()} Sudheesh S Pai &mdash; Done as part of internship at Hexinox
    </footer>
  );
}
function Offers() {
  const [email, setEmail] = React.useState('');
  const [status, setStatus] = React.useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('Submitting...');
    try {
      await emailjs.send(
        'service_9zew0gh',
        'template_0z44tq4',
        { user_email: email },
        'ZZcpzagnttc3M_Bmv'
      );
      setStatus('Thank you for subscribing!');
      setEmail('');
    } catch (err) {
     
      setStatus('Failed to subscribe. Please try again.');
    }
  };

  return (
    <section id="offers" style={{ padding: '10px 0', textAlign: 'center' }}>
      <h2 style={{ marginBottom: '8px' }}>Our Offers</h2>
      <p style={{ marginBottom: '8px' }}>Check out our exclusive offers and discounts!</p>
      <form
        onSubmit={handleSubmit}
        style={{
          marginTop: '0px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '8px', // reduced gap
        }}
      >
        <input
          type="email"
          name="user_email"
          placeholder="your@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          style={{
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid #ccc',
            fontSize: '1rem',
            minWidth: '240px',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '12px 24px',
            borderRadius: '8px',
            border: 'none',
            background: '#007bff',
            color: '#fff',
            fontWeight: 'bold',
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          Subscribe
        </button>
      </form>
      {status && (
        <div style={{ marginTop: '8px', color: '#fff', fontWeight: 500 }}>
          {status}
        </div>
      )}
    </section>
  );
}

function App() {
  return (
    <div style={{ background: '#000', minHeight: '100vh', width: '100vw', overflowX: 'hidden', position: 'relative' }}>
      <Navbar />
      {/* Remove or reduce spacer for navbar */}
      <div style={{ height: '24px' }} /> {/* Reduced spacer */}
      <Home />
      <SplashCursor />
      {/* Small space for scroll velocity */}
      <div style={{ height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ScrollVelocity
          texts={['About','Zelion']}
          velocity={280}
          className="custom-scroll-text"
        />
      </div>
      <About />
      <Products />
      <GallerySection />
     <div style={{ marginTop: '4rem' }}>
<DecryptedText
  text=" There is an offer for you!"
  animateOn="view"
  revealDirection="center"
  parentClassName="decrypted-offer-title"
/>
</div>
     <div className="decrypted-offer-highlight">
       <DecryptedText
         text="Check below for exclusive deals on Zelion Cricket balls. Unleash your champion within! "
         animateOn="view"
         revealDirection="center"
         parentClassName="decrypted-offer-highlight-text"
       />
     </div>
      <div>
<DecryptedText
  text="  only for limited time! Take advantage of this offer now!"
  animateOn="view"
  revealDirection="center"
  parentClassName="decrypted-offer-limited"
/>
</div>
      <Offers/>
      <Testimonials />
      <Contact />
      <Footer />
    </div>
  );
}
export default App;