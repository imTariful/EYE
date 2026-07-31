# U-Net/DeepLabV3+ Segmentation Model Integration Plan

## Overview
This document outlines the plan for integrating a lightweight, quantized U-Net or DeepLabV3+ model for pixel-level segmentation of the pupil and photorefraction crescent in the OcuRisk AI application.

## Use Case
- **Input**: Eye region cropped by MediaPipe FaceLandmarker
- **Output**: Pixel-level segmentation masks for pupil and crescent
- **Purpose**: Extract geometric features (Pupil Diameter, Crescent Width, Reflex Intensity) with higher accuracy than current methods

## Model Selection

### Option 1: U-Net (Lightweight)
- **Pros**: Simple architecture, fast inference, good for binary segmentation
- **Cons**: May require custom training for crescent detection
- **Implementation**: MobileNetV2 backbone for efficiency

### Option 2: DeepLabV3+ (Recommended)
- **Pros**: State-of-the-art semantic segmentation, handles edge cases better, pre-trained models available
- **Cons**: Slightly larger model size
- **Implementation**: MobileNetV2 or EfficientNet-Lite backbone for mobile deployment

## Technical Architecture

### Workflow
```
1. MediaPipe FaceLandmarker → Crop Eye Region (128x128 or 256x256)
2. Preprocessing → Normalize, Resize
3. Segmentation Model → Generate Masks (Pupil, Crescent, Background)
4. Post-processing → Morphological operations, Contour extraction
5. Feature Extraction → PD, CW, RI calculations
6. Integration → Update existing opticsEngine.ts functions
```

### Model Specifications
- **Input Size**: 128x128 or 256x256 RGB images
- **Output**: 3-channel mask (Pupil, Crescent, Background)
- **Backbone**: MobileNetV2 (width multiplier 0.35 or 0.5)
- **Quantization**: INT8 for TFLite/WebAssembly deployment
- **Target FPS**: 30+ on mobile devices

## Implementation Steps

### Phase 1: Model Preparation
1. **Dataset Collection**
   - Collect labeled eye images with pupil and crescent annotations
   - Minimum 500-1000 images for training
   - Include various lighting conditions, refractive states

2. **Model Training**
   - Use TensorFlow or PyTorch for training
   - Implement data augmentation (rotation, brightness, blur)
   - Train on Google Colab or local GPU
   - Export to TFLite format

3. **Model Optimization**
   - Apply post-training quantization
   - Test accuracy vs. size trade-offs
   - Target model size: <5MB

### Phase 2: Web Integration
1. **TensorFlow.js Integration**
   - Install `@tensorflow/tfjs` and `@tensorflow/tfjs-converter`
   - Load TFLite model in browser
   - Implement WebGL backend for GPU acceleration

2. **New Utility Module**
   - Create `src/utils/segmentationEngine.ts`
   - Implement model loading and inference
   - Add preprocessing/postprocessing functions

3. **Integration with Eye Tracker**
   - Modify `eyeTracker.ts` to call segmentation model
   - Replace or augment current pupil detection
   - Add crescent segmentation logic

### Phase 3: Feature Extraction
1. **Geometric Feature Calculation**
   - Pupil Diameter: From mask contour area
   - Crescent Width: Measure crescent region along pupil boundary
   - Reflex Intensity: Average pixel intensity in crescent region

2. **Update Optics Engine**
   - Modify `calculatePhotorefraction` to use segmentation features
   - Add new function `calculateSegmentationFeatures`
   - Maintain backward compatibility with existing methods

## Code Structure

### New File: `src/utils/segmentationEngine.ts`
```typescript
export class SegmentationEngine {
  private model: tf.LayersModel | null = null;
  private isLoaded: boolean = false;

  async loadModel(): Promise<void> {
    // Load TFLite model from public/models/
  }

  async segmentEyeRegion(imageData: ImageData): Promise<SegmentationResult> {
    // Preprocess, run inference, postprocess
    // Return masks for pupil and crescent
  }

  extractFeatures(mask: SegmentationMask): PupilCrescentFeatures {
    // Calculate PD, CW, RI from masks
  }
}

interface SegmentationResult {
  pupilMask: ImageData;
  crescentMask: ImageData;
  confidence: number;
}

interface PupilCrescentFeatures {
  pupilDiameterMm: number;
  crescentWidthPx: number;
  reflexIntensity: number;
  crescentOrientation: 'TOP' | 'BOTTOM' | 'SYMMETRIC';
}
```

### Modified: `src/utils/eyeTracker.ts`
```typescript
// Add segmentation engine instance
private segmentationEngine = new SegmentationEngine();

// In processFrame, after MediaPipe detection:
if (this.segmentationEngine.isLoaded) {
  const crop = this.cropEyeRegion(landmarks);
  const segmentation = await this.segmentationEngine.segmentEyeRegion(crop);
  const features = this.segmentationEngine.extractFeatures(segmentation);
  // Update result with segmentation features
}
```

## Performance Considerations

### Optimization Strategies
1. **Model Caching**: Load model once on app initialization
2. **Async Inference**: Run segmentation in background thread
3. **Selective Processing**: Only run segmentation on stable frames
4. **Fallback**: Use existing methods if segmentation fails

### Memory Management
- Reuse tensor objects to avoid garbage collection
- Dispose tensors after inference
- Limit model instances to one per session

## Testing Plan

### Unit Tests
- Test model loading and inference
- Validate feature extraction accuracy
- Test edge cases (blur, low light)

### Integration Tests
- Test with real camera feed
- Verify performance on mobile devices
- Compare accuracy with existing methods

### Validation
- Measure PD, CW, RI accuracy against ground truth
- Benchmark inference time (target: <50ms per frame)
- Test on various eye conditions (myopia, hyperopia, astigmatism)

## Timeline Estimate

- **Phase 1 (Model Prep)**: 2-3 weeks
  - Dataset collection: 1 week
  - Training and optimization: 1-2 weeks

- **Phase 2 (Web Integration)**: 1-2 weeks
  - TensorFlow.js setup: 2-3 days
  - Integration with eye tracker: 3-5 days
  - Testing and debugging: 2-3 days

- **Phase 3 (Feature Extraction)**: 1 week
  - Feature calculation: 2-3 days
  - Optics engine updates: 2-3 days
  - Validation: 1-2 days

**Total**: 4-6 weeks

## Dependencies

### New Packages
```json
{
  "@tensorflow/tfjs": "^4.17.0",
  "@tensorflow/tfjs-converter": "^4.17.0",
  "@tensorflow/tfjs-backend-webgl": "^4.17.0"
}
```

### Model Files
- `public/models/eye-segmentation.tflite` - Quantized model
- `public/models/eye-segmentation.json` - Model metadata

## Risks and Mitigation

### Risk 1: Model Accuracy
- **Mitigation**: Extensive training with diverse dataset, data augmentation
- **Fallback**: Keep existing detection methods as backup

### Risk 2: Performance Impact
- **Mitigation**: Optimize model size, use WebGL acceleration, selective processing
- **Fallback**: Disable segmentation on low-end devices

### Risk 3: Dataset Availability
- **Mitigation**: Use synthetic data generation, collaborate with research institutions
- **Alternative**: Use pre-trained models and fine-tune

## Success Metrics

- **Accuracy**: PD error <0.5mm, CW error <10px
- **Performance**: Inference time <50ms, FPS >30
- **Model Size**: <5MB after quantization
- **Compatibility**: Works on Chrome, Safari, Firefox (desktop and mobile)

## Next Steps

1. **Dataset Collection**: Begin gathering labeled eye images
2. **Model Selection**: Decide between U-Net and DeepLabV3+
3. **Prototype**: Build simple TensorFlow.js proof-of-concept
4. **Integration Planning**: Detailed API design for segmentation engine

## References

- U-Net: Ronneberger et al., "U-Net: Convolutional Networks for Biomedical Image Segmentation" (2015)
- DeepLabV3+: Chen et al., "Encoder-Decoder with Atrous Separable Convolution" (2018)
- TensorFlow.js: https://www.tensorflow.org/js
- MediaPipe Face Landmarker: https://developers.google.com/mediapipe/solutions/face_landmarker
