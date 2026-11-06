// Copia as bibliotecas de node_modules para public/vendor (o site roda sem build e sem CDN).
import { cpSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const files = {
  'node_modules/@google/model-viewer/dist/model-viewer.min.js': 'public/vendor/model-viewer.min.js',
  'node_modules/three/build/three.module.min.js': 'public/vendor/three/three.module.min.js',
  'node_modules/three/build/three.core.min.js': 'public/vendor/three/three.core.min.js',
  'node_modules/three/examples/jsm/exporters/GLTFExporter.js': 'public/vendor/three/addons/exporters/GLTFExporter.js',
  'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js': 'public/vendor/three/addons/utils/BufferGeometryUtils.js',
  'node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js': 'public/vendor/three/addons/geometries/RoundedBoxGeometry.js',
  'node_modules/three/examples/jsm/loaders/GLTFLoader.js': 'public/vendor/three/addons/loaders/GLTFLoader.js',
  'node_modules/three/examples/jsm/utils/SkeletonUtils.js': 'public/vendor/three/addons/utils/SkeletonUtils.js',
  'node_modules/three/examples/jsm/environments/RoomEnvironment.js': 'public/vendor/three/addons/environments/RoomEnvironment.js',
  'node_modules/three/examples/jsm/loaders/DRACOLoader.js': 'public/vendor/three/addons/loaders/DRACOLoader.js',
  'node_modules/three/examples/jsm/libs/meshopt_decoder.module.js': 'public/vendor/three/addons/libs/meshopt_decoder.module.js',
  'node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js': 'public/vendor/three/addons/libs/draco/gltf/draco_decoder.js',
  'node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm': 'public/vendor/three/addons/libs/draco/gltf/draco_decoder.wasm',
  'node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js': 'public/vendor/three/addons/libs/draco/gltf/draco_wasm_wrapper.js',
  'node_modules/meshoptimizer/meshopt_simplifier.js': 'public/vendor/meshopt_simplifier.js',
  'node_modules/@supabase/supabase-js/dist/umd/supabase.js': 'public/vendor/supabase.js',
  'node_modules/qrcode-generator/dist/qrcode.js': 'public/vendor/qrcode.js',
};
for (const [from, to] of Object.entries(files)) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  console.log('ok', to);
}
