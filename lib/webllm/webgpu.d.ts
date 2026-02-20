// Minimal WebGPU types for navigator.gpu access
// Full types available via @webgpu/types package if needed
interface GPU {
  requestAdapter(): Promise<GPUAdapter | null>;
}

// GPUAdapter is opaque — we only check for null/non-null from requestAdapter()
type GPUAdapter = object;

interface Navigator {
  readonly gpu?: GPU;
}
