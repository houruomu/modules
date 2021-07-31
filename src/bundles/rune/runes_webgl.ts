/**
 * This file contains the module's private functions that handles various webgl operations.
 */

import { mat4 } from 'gl-matrix';
import { FrameBufferWithTexture, Rune } from './types';
import { flattenRune } from './runes_ops';
import { blank, overlay_frac, scale, square, white } from './functions';

// =============================================================================
// Private functions
// =============================================================================

const normalVertexShader = `
attribute vec4 aVertexPosition;
uniform vec4 uVertexColor;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
uniform vec4 uColorFilter;

varying lowp vec4 vColor;
void main(void) {
  gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
  vColor = uVertexColor;
  vColor = uColorFilter * vColor + 1.0 - uColorFilter;
  vColor.a = 1.0;
}
`;

const normalFragmentShader = `
varying lowp vec4 vColor;
void main(void) {
  gl_FragColor = vColor;
}
`;

const combineVertexShader = `
attribute vec4 a_position;
varying highp vec2 v_texturePosition;
void main() {
    gl_Position = a_position;
    v_texturePosition.x = (a_position.x + 1.0) / 2.0;
    v_texturePosition.y = (a_position.y + 1.0) / 2.0;
}
`;

const combineFragmentShader = `
precision mediump float;
uniform sampler2D u_sampler_red;
uniform sampler2D u_sampler_cyan;
varying highp vec2 v_texturePosition;
void main() {
    gl_FragColor = texture2D(u_sampler_red, v_texturePosition)
            + texture2D(u_sampler_cyan, v_texturePosition) - 1.0;
    gl_FragColor.a = 1.0;
}
`;

// The following 2 functions loadShader and initShaderProgram are copied from the curve library, 26 Jul 2021 with no change. This unfortunately violated DIY priciple but I have no choice as those functions are not exported.
/**
 * Gets shader based on given shader program code.
 *
 * @param gl - WebGL's rendering context
 * @param type - constant describing the type of shader to load
 * @param source - source code of the shader
 * @returns WebGLShader used to initialize shader program
 */
function loadShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('WebGLShader not available.');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

/**
 * Initializes the shader program used by WebGL.
 *
 * @param gl - WebGL's rendering context
 * @param vsSource - vertex shader program code
 * @param fsSource - fragment shader program code
 * @returns WebGLProgram used for getting AttribLocation and UniformLocation
 */
function initShaderProgram(
  gl: WebGLRenderingContext,
  vsSource: string,
  fsSource: string
): WebGLProgram {
  const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
  const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const shaderProgram = gl.createProgram();
  if (!shaderProgram) {
    throw new Error('Unable to initialize the shader program.');
  }
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);
  return shaderProgram;
}

/**
 * get a WebGLRenderingContext from Canvas input
 * @param canvas WebGLRenderingContext
 * @returns
 */
function getWebGlFromCanvas(canvas: HTMLCanvasElement): WebGLRenderingContext {
  const gl: WebGLRenderingContext | null = canvas.getContext('webgl');
  if (!gl) {
    throw Error('Unable to initialize WebGL.');
  }
  gl.clearColor(1.0, 1.0, 1.0, 1.0); // Set clear color to white, fully opaque
  gl.enable(gl.DEPTH_TEST); // Enable depth testing
  gl.depthFunc(gl.LEQUAL); // Near things obscure far things
  // eslint-disable-next-line no-bitwise
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); // Clear the viewport
  return gl;
}

/**
 * Draws the list of runes with the prepared WebGLRenderingContext, with each rune overlapping each other onto a given framebuffer. if the framebuffer is null, draw to the default canvas.
 *
 * @param gl a prepared WebGLRenderingContext with shader program linked
 * @param runes a list of rune (Rune[]) to be drawn sequentially
 */
function drawRunesToFrameBuffer(
  gl: WebGLRenderingContext,
  runes: Rune[],
  cameraMatrix: mat4,
  colorFilter: Float32Array,
  framebuffer: WebGLFramebuffer | null = null
) {
  // step 1: initiate the WebGLRenderingContext
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  // step 2: initiate the shaderProgram
  const shaderProgram = initShaderProgram(
    gl,
    normalVertexShader,
    normalFragmentShader
  );
  gl.useProgram(shaderProgram);
  if (gl === null) {
    throw Error('Rendering Context not initialized for drawRune.');
  }

  // create pointers to the data-entries of the shader program
  const vertexPositionPointer = gl.getAttribLocation(
    shaderProgram,
    'aVertexPosition'
  );
  const vertexColorPointer = gl.getUniformLocation(
    shaderProgram,
    'uVertexColor'
  );
  const vertexColorFilterPt = gl.getUniformLocation(
    shaderProgram,
    'uColorFilter'
  );
  const projectionMatrixPointer = gl.getUniformLocation(
    shaderProgram,
    'uProjectionMatrix'
  );
  const modelViewMatrixPointer = gl.getUniformLocation(
    shaderProgram,
    'uModelViewMatrix'
  );

  // load camera
  gl.uniformMatrix4fv(projectionMatrixPointer, false, cameraMatrix);

  // load colorfilter
  gl.uniform4fv(vertexColorFilterPt, colorFilter);

  // 3. draw each Rune using the shader program
  runes.forEach((rune: Rune) => {
    // load position buffer
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rune.vertices, gl.STATIC_DRAW);
    gl.vertexAttribPointer(vertexPositionPointer, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vertexPositionPointer);

    // load color
    if (rune.colors != null) {
      gl.uniform4fv(vertexColorPointer, rune.colors);
    } else {
      gl.uniform4fv(vertexColorPointer, new Float32Array([0, 0, 0, 1]));
    }

    // load transformation matrix
    gl.uniformMatrix4fv(modelViewMatrixPointer, false, rune.transformMatrix);

    // draw
    const vertexCount = rune.vertices.length / 4;
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
  });
}

/**
 * creates a framebuffer
 * @param gl WebGLRenderingContext
 * @returns FrameBufferWithTexture
 */
function initFramebufferObject(
  gl: WebGLRenderingContext
): FrameBufferWithTexture {
  // create a framebuffer object
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) {
    throw Error('Failed to create frame buffer object');
  }

  // create a texture object and set its size and parameters
  const texture = gl.createTexture();
  if (!texture) {
    throw Error('Failed to create texture object');
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.drawingBufferWidth,
    gl.drawingBufferHeight,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

  // create a renderbuffer for depth buffer
  const depthBuffer = gl.createRenderbuffer();
  if (!depthBuffer) {
    throw Error('Failed to create renderbuffer object');
  }

  // bind renderbuffer object to target and set size
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
  gl.renderbufferStorage(
    gl.RENDERBUFFER,
    gl.DEPTH_COMPONENT16,
    gl.drawingBufferWidth,
    gl.drawingBufferHeight
  );

  // set the texture object to the framebuffer object
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); // bind to target
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );
  // set the renderbuffer object to the framebuffer object
  gl.framebufferRenderbuffer(
    gl.FRAMEBUFFER,
    gl.DEPTH_ATTACHMENT,
    gl.RENDERBUFFER,
    depthBuffer
  );

  // check whether the framebuffer is configured correctly
  const e = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (gl.FRAMEBUFFER_COMPLETE !== e) {
    throw Error(`Frame buffer object is incomplete:${e.toString()}`);
  }

  // Unbind the buffer object
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);

  return {
    framebuffer,
    texture,
  };
}

// =============================================================================
// Exposed functions
// =============================================================================

/**
 * Draw the rune in the tab, including all the sub runes.
 *
 * @param canvas HTMLCanvasElement element in the tab
 * @param rune the Rune to be drawn
 */
export function drawRune(canvas: HTMLCanvasElement, rune: Rune) {
  const gl = getWebGlFromCanvas(canvas);
  const runes = flattenRune(rune);

  // prepare camera projection array
  const cameraMatrix = mat4.create();
  const fieldOfView = (90 * Math.PI) / 180; // in radians
  const aspect = 1; // width/height
  const zNear = 0.1;
  const zFar = 100.0;
  mat4.perspective(cameraMatrix, fieldOfView, aspect, zNear, zFar);
  // prepare the default zero point of the model
  mat4.translate(cameraMatrix, cameraMatrix, [-0.0, 0.0, -1]);

  // color filter set to [1,1,1,1] for transparent filter
  drawRunesToFrameBuffer(
    gl,
    runes,
    cameraMatrix,
    new Float32Array([1, 1, 1, 1]),
    null
  );
}

/**
 * Draw the rune in the tab, including all the sub runes in anaglyph mode.
 * It first renders two frames with respective colorfilters and cameras for the left and right
 * eye, and then combine the two frames in the canvas.
 *
 * @param canvas HTMLCanvasElement element in the tab
 * @param rune the Rune to be drawn
 */
export function drawAnaglyph(canvas: HTMLCanvasElement, rune: Rune) {
  const gl = getWebGlFromCanvas(canvas);

  // before draw the runes to framebuffer, we need to first draw a white background to cover the transparent places
  let runes = flattenRune(rune);
  runes = flattenRune(
    white(overlay_frac(0.999999999, blank, scale(2.2, square)))
  ).concat(runes);

  // calculate the left and right camera matrices
  const halfEyeDistance = 0.03;
  const fieldOfView = (90 * Math.PI) / 180; // in radians
  const aspect = 1; // width/height
  const zNear = 0.1;
  const zFar = 100.0;
  const leftCameraMatrix = mat4.create();
  mat4.perspective(leftCameraMatrix, fieldOfView, aspect, zNear, zFar);
  // prepare the default zero point of the model
  mat4.translate(leftCameraMatrix, leftCameraMatrix, [
    -halfEyeDistance,
    0.0,
    -1.0,
  ]);
  const rightCameraMatrix = mat4.create();
  mat4.perspective(rightCameraMatrix, fieldOfView, aspect, zNear, zFar);
  // prepare the default zero point of the model
  mat4.translate(rightCameraMatrix, rightCameraMatrix, [
    halfEyeDistance,
    0.0,
    -1.0,
  ]);

  // left/right eye images are drawn into respective framebuffers
  const leftBuffer = initFramebufferObject(gl);
  const rightBuffer = initFramebufferObject(gl);
  drawRunesToFrameBuffer(
    gl,
    runes,
    leftCameraMatrix,
    new Float32Array([1, 0, 0, 1]),
    leftBuffer.framebuffer
  );
  drawRunesToFrameBuffer(
    gl,
    runes,
    rightCameraMatrix,
    new Float32Array([0, 1, 1, 1]),
    rightBuffer.framebuffer
  );

  // prepare to draw to screen by setting framebuffer to null
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  // prepare the shader program to combine the left/right eye images
  const shaderProgram = initShaderProgram(
    gl,
    combineVertexShader,
    combineFragmentShader
  );
  gl.useProgram(shaderProgram);
  const reduPt = gl.getUniformLocation(shaderProgram, 'u_sampler_red');
  const cyanuPt = gl.getUniformLocation(shaderProgram, 'u_sampler_cyan');
  const vertexPositionPointer = gl.getAttribLocation(
    shaderProgram,
    'a_position'
  );

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, leftBuffer.texture);
  gl.uniform1i(cyanuPt, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, rightBuffer.texture);
  gl.uniform1i(reduPt, 1);

  // draw a square, which will allow the texture to be used
  // load position buffer
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, square.vertices, gl.STATIC_DRAW);
  gl.vertexAttribPointer(vertexPositionPointer, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(vertexPositionPointer);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

/**
 * Draw the rune in the tab, including all the sub runes with hollusion effect.
 * It varies the camera position with time, and the runes are drawn with this animated
 * camera to create a 3D effect.
 * @param canvas HTMLCanvasElement element in the tab
 * @param rune the Rune to be drawn
 */
export function drawHollusion(canvas: HTMLCanvasElement, rune: Rune) {
  const gl = getWebGlFromCanvas(canvas);
  const runes = flattenRune(rune);

  // the browser will call this render function repeatedly for updating the canvas
  function render(timeInMs: number) {
    gl.clearColor(1.0, 1.0, 1.0, 1.0); // Set clear color to white, fully opaque
    // eslint-disable-next-line no-bitwise
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); // Clear the viewport

    // prepare camera projection array
    const cameraMatrix = mat4.create();
    const fieldOfView = (90 * Math.PI) / 180; // in radians
    const aspect = 1; // width/height
    const zNear = 0.1;
    const zFar = 100.0;
    mat4.perspective(cameraMatrix, fieldOfView, aspect, zNear, zFar);

    // let the object shift in the x direction
    // the following calculation will let x oscillate in (-xshiftMax, xshiftMax) with time
    const xshiftMax = 0.03;
    const period = 2000;
    let xshift = timeInMs % period;
    if (xshift > period / 2) {
      xshift = period - xshift;
    }
    xshift = 2 * xshiftMax * (xshift / period);
    mat4.translate(cameraMatrix, cameraMatrix, [
      xshift - xshiftMax / 2,
      0.0,
      -1,
    ]);

    drawRunesToFrameBuffer(
      gl,
      runes,
      cameraMatrix,
      new Float32Array([1, 1, 1, 1]),
      null
    );
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}
