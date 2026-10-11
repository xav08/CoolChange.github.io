import { useEffect, useRef } from "react";

const vertexSource = `
  attribute vec2 position;
  varying vec2 uv;
  void main() {
    uv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentSource = `
  precision highp float;
  uniform sampler2D artwork;
  uniform vec2 resolution;
  uniform float time;
  varying vec2 uv;

  float foliage(vec3 colour) {
    return smoothstep(0.025, 0.09, colour.g - colour.b)
      * smoothstep(0.0, 0.025, colour.g - colour.r);
  }

  void main() {
    vec2 pixel = 1.0 / resolution;
    float top = 1.0 - uv.y;
    // Extend the foliage mask across the contour so it moves cleanly. The
    // original cream background, brown branches and ground shade stay fixed.
    float leaf = max(foliage(texture2D(artwork, uv).rgb),
      max(foliage(texture2D(artwork, uv + vec2(7.0 * pixel.x, 0.0)).rgb),
          foliage(texture2D(artwork, uv - vec2(7.0 * pixel.x, 0.0)).rgb)));
    float canopy = smoothstep(0.04, 0.1, top)
      * (1.0 - smoothstep(0.6, 0.69, top)) * leaf;
    float breeze = sin(time * 6.283185 / 4.2 - uv.x * 2.1) * 3.6
      + sin(time * 6.283185 / 3.6 + top * 3.0) * 1.0;
    float flutter = sin(time * 6.283185 / 4.7 + uv.x * 3.0) * 0.9;
    vec2 movement = vec2(breeze, flutter) * pixel * canopy
      * smoothstep(0.0, 0.75, time);
    gl_FragColor = texture2D(artwork, uv - movement);
  }
`;

// Animate the original illustration directly; no 3D scene or recreated asset.
export function WelcomeCanopy() {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const surface = canvas.current, illustration = image.current, container = root.current;
    if (!surface || !illustration || !container) return;
    const gl = surface.getContext("webgl", { alpha: false, antialias: false, depth: false, powerPreference: "low-power" });
    if (!gl) return;
    let disposed = false, ready = false, frame = 0, lastDraw = -100;
    let previousTime = 0, elapsed = 0;
    const shaders: WebGLShader[] = [];
    const program = gl.createProgram(), buffer = gl.createBuffer(), texture = gl.createTexture();
    if (!program || !buffer || !texture) return;

    function compile(type: number, source: string) {
      const shader = gl!.createShader(type);
      if (!shader) throw new Error("Canopy shader unavailable");
      shaders.push(shader);
      gl!.shaderSource(shader, source);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error("Canopy shader failed");
      gl!.attachShader(program, shader);
    }

    let timeUniform: WebGLUniformLocation | null = null;
    let resolutionUniform: WebGLUniformLocation | null = null;
    function resize() {
      if (!ready || disposed) return;
      const width = container!.clientWidth, height = container!.clientHeight;
      const ratio = Math.min(window.devicePixelRatio, 1.5);
      surface!.width = Math.round(width * ratio);
      surface!.height = Math.round(height * ratio);
      gl!.viewport(0, 0, surface!.width, surface!.height);
      gl!.uniform2f(resolutionUniform, width, height);
      gl!.uniform1f(timeUniform, elapsed);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    }

    function draw(now: number) {
      frame = 0;
      if (disposed || !ready || document.hidden) return;
      if (previousTime) elapsed += Math.min(now - previousTime, 100) / 1000;
      previousTime = now;
      if (now - lastDraw >= 1000 / 30) {
        gl!.uniform1f(timeUniform, elapsed);
        gl!.drawArrays(gl!.TRIANGLES, 0, 6);
        lastDraw = now;
      }
      frame = requestAnimationFrame(draw);
    }

    function visibilityChanged() {
      cancelAnimationFrame(frame); frame = 0; previousTime = 0;
      if (!document.hidden && ready && !disposed) frame = requestAnimationFrame(draw);
    }
    function contextLost(event: Event) {
      event.preventDefault();
      ready = false;
      cancelAnimationFrame(frame);
      container!.classList.remove("is-animated");
    }
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    surface.addEventListener("webglcontextlost", contextLost);
    document.addEventListener("visibilitychange", visibilityChanged);

    async function initialise() {
      try {
        await illustration!.decode();
        if (disposed) return;
        compile(gl!.VERTEX_SHADER, vertexSource);
        compile(gl!.FRAGMENT_SHADER, fragmentSource);
        gl!.linkProgram(program);
        if (!gl!.getProgramParameter(program, gl!.LINK_STATUS)) throw new Error("Canopy program failed");
        gl!.useProgram(program);
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
        gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl!.STATIC_DRAW);
        const position = gl!.getAttribLocation(program, "position");
        gl!.enableVertexAttribArray(position);
        gl!.vertexAttribPointer(position, 2, gl!.FLOAT, false, 0, 0);
        gl!.bindTexture(gl!.TEXTURE_2D, texture);
        gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, true);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
        gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, illustration!);
        gl!.uniform1i(gl!.getUniformLocation(program, "artwork"), 0);
        timeUniform = gl!.getUniformLocation(program, "time");
        resolutionUniform = gl!.getUniformLocation(program, "resolution");
        ready = true;
        resize();
        container!.classList.add("is-animated");
        if (!document.hidden) frame = requestAnimationFrame(draw);
      } catch {
        // The original image remains visible if graphics acceleration fails.
        container!.classList.remove("is-animated");
      }
    }
    void initialise();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      surface.removeEventListener("webglcontextlost", contextLost);
      document.removeEventListener("visibilitychange", visibilityChanged);
      container.classList.remove("is-animated");
      gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program);
      shaders.forEach(shader => gl.deleteShader(shader));
    };
  }, []);

  return <div ref={root} className="welcome-art">
    <img ref={image} src={`${import.meta.env.BASE_URL}images/welcome-tree-c.png`}
      width="1536" height="1024" alt="A broad green tree casting a soft, cooling shadow."
      fetchPriority="high" draggable={false} />
    <canvas ref={canvas} aria-hidden="true" />
  </div>;
}
