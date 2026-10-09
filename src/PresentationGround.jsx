import React from 'react';

const vertexShader = `
  varying vec2 vGroundPosition;

  void main() {
    vGroundPosition = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 vGroundPosition;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    vec2 blend = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(cell), hash(cell + vec2(1.0, 0.0)), blend.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), blend.x),
      blend.y
    );
  }

  float filteredGrain(vec2 p) {
    // Fade subpixel detail at grazing angles instead of shimmering at the horizon.
    vec2 footprint = fwidth(p);
    float detail = 1.0 - smoothstep(0.35, 1.25, max(footprint.x, footprint.y));
    return (noise(p) - 0.5) * detail;
  }

  void main() {
    // Physical-scale detail, independent of the size of the presentation plane.
    float grain = filteredGrain(vGroundPosition * 0.7) * 0.004
      + filteredGrain(vGroundPosition * 7.0) * 0.007
      + filteredGrain(vGroundPosition * 90.0) * 0.004;
    float fade = 1.0 - smoothstep(9.0, 19.6, length(vGroundPosition));
    // Linear-space charcoal; convert once to the renderer's output colour space.
    gl_FragColor = vec4(vec3(0.0423, 0.0423, 0.0437) + grain, fade);
    #include <colorspace_fragment>
  }
`;

export default function PresentationGround() {
  return (
    <mesh position={[0, -0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <planeGeometry args={[40, 40]} />
      <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
