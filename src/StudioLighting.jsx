import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function StudioLighting({ width, depth }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const [hasEnvironment, setHasEnvironment] = useState(false);

  useLayoutEffect(() => {
    const previousEnvironment = scene.environment;
    const previousIntensity = scene.environmentIntensity;
    const studio = new RoomEnvironment();
    const generator = new PMREMGenerator(gl);
    let environment;
    try {
      environment = generator.fromScene(studio, 0.035);
    } catch (error) {
      console.warn('Studio environment unavailable', error);
    } finally {
      studio.dispose();
      generator.dispose();
    }
    setHasEnvironment(Boolean(environment));
    if (!environment) return;
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.42;
    return () => {
      scene.environment = previousEnvironment;
      scene.environmentIntensity = previousIntensity;
      environment.dispose();
    };
  }, [gl, scene]);

  const light = useRef(null);
  const span = Math.max(5, Math.hypot(width, depth) / 2 + 1.4);
  useLayoutEffect(() => {
    light.current?.shadow.camera.updateProjectionMatrix();
  }, [hasEnvironment, span]);

  return hasEnvironment ? (
    <>
      <ambientLight intensity={0.24} />
      <directionalLight
        ref={light}
        position={[4, 8, 5]}
        intensity={1.38}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-far={25}
        shadow-normalBias={0.02}
      />
    </>
  ) : (
    <>
      <ambientLight intensity={1.42} />
      <directionalLight position={[3, 7, 4]} intensity={0.72} castShadow shadow-mapSize={[2048, 2048]} />
    </>
  );
}

export function StudioContactShadows({ width, depth }) {
  const shadowWidth = Math.max(12, width + 2);
  const shadowDepth = Math.max(12, depth + 2);
  const scale = useMemo(() => [shadowWidth, shadowDepth], [shadowWidth, shadowDepth]);
  return (
    <ContactShadows
      opacity={0.19}
      scale={scale}
      blur={2.1}
      far={0.9}
      position={[0, 0.015, 0]}
    />
  );
}
