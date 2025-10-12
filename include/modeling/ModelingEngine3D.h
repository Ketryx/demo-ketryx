```cpp
#ifndef MODELINGENGINE3D_H
#define MODELINGENGINE3D_H

#include <string>
#include <vector>
#include <memory>
#include <functional>
#include <exception>
#include <cstdint>
#include <optional>

namespace modeling3d {

// Error codes for ModelingEngine3D operations
enum class ErrorCode : int32_t {
    SUCCESS = 0,
    INVALID_INPUT,
    SEGMENTATION_FAILED,
    RECONSTRUCTION_FAILED,
    CONFIGURATION_ERROR,
    UNKNOWN_ERROR
};

// Exception base class for ModelingEngine3D
class ModelingEngineException : public std::exception {
public:
    explicit ModelingEngineException(ErrorCode code, std::string message) noexcept
        : code_(code), message_(std::move(message)) {}

    const char* what() const noexcept override { return message_.c_str(); }
    ErrorCode code() const noexcept { return code_; }

private:
    ErrorCode code_;
    std::string message_;
};

class InvalidInputException : public ModelingEngineException {
public:
    InvalidInputException()
        : ModelingEngineException(ErrorCode::INVALID_INPUT, "Invalid input data.") {}
};

class SegmentationException : public ModelingEngineException {
public:
    SegmentationException()
        : ModelingEngineException(ErrorCode::SEGMENTATION_FAILED, "Segmentation process failed.") {}
};

class ReconstructionException : public ModelingEngineException {
public:
    ReconstructionException()
        : ModelingEngineException(ErrorCode::RECONSTRUCTION_FAILED, "3D reconstruction failed.") {}
};

class ConfigurationException : public ModelingEngineException {
public:
    ConfigurationException()
        : ModelingEngineException(ErrorCode::CONFIGURATION_ERROR, "Invalid configuration parameters.") {}
};

// Data structure representing volumetric CT input data
struct CTVolumeData {
    int32_t width;         // number of voxels in X dimension
    int32_t height;        // number of voxels in Y dimension
    int32_t depth;         // number of voxels in Z dimension
    float voxelSpacingX;   // spacing in mm
    float voxelSpacingY;
    float voxelSpacingZ;
    std::vector<uint16_t> voxelData; // raw CT data, size = width * height * depth, stored in z-fastest order

    bool isValid() const noexcept {
        return width > 0 && height > 0 && depth > 0 && voxelData.size() == static_cast<size_t>(width)*height*depth;
    }
};

// Data structure for 3D model vertex
struct ModelVertex {
    float x, y, z;
};

// Data structure for 3D model face (triangle)
struct ModelFace {
    uint32_t v1, v2, v3; // indices of vertices making the triangle
};

// Data structure holding a reconstructed 3D model mesh
struct Model3D {
    std::vector<ModelVertex> vertices;
    std::vector<ModelFace> faces;

    bool isValid() const noexcept {
        return !vertices.empty() && !faces.empty();
    }
};

// Configuration parameters for segmentation
struct SegmentationConfig {
    float thresholdLow;       // lower threshold intensity for segmentation
    float thresholdHigh;      // upper threshold intensity for segmentation
    int32_t smoothingKernel;  // size of smoothing filter kernel, odd number >= 1
    bool useAdaptiveThreshold; 

    SegmentationConfig() noexcept
        : thresholdLow(0.0f), thresholdHigh(4096.0f), smoothingKernel(3), useAdaptiveThreshold(false) {}
};

// Configuration parameters for 3D reconstruction
struct ReconstructionConfig {
    bool generateNormals;     // whether to compute normals
    float meshDecimationRatio; // 0.0 (max decimation) to 1.0 (no decimation)
    bool fillHoles;
    
    ReconstructionConfig() noexcept
        : generateNormals(true), meshDecimationRatio(1.0f), fillHoles(true) {}
};

// Callback interface for progress reporting
class IModelingProgressCallback {
public:
    virtual ~IModelingProgressCallback() = default;
    // progress: 0.0 (start) to 1.0 (complete)
    virtual void onProgress(float progress, std::string_view stage) noexcept = 0;
};

// Main 3D modeling engine interface
class ModelingEngine3D {
public:
    ModelingEngine3D();
    ~ModelingEngine3D();

    ModelingEngine3D(const ModelingEngine3D&) = delete;
    ModelingEngine3D& operator=(const ModelingEngine3D&) = delete;
    ModelingEngine3D(ModelingEngine3D&&) noexcept = default;
    ModelingEngine3D& operator=(ModelingEngine3D&&) noexcept = default;

    // Set segmentation configuration
    void setSegmentationConfig(const SegmentationConfig& config);
    [[nodiscard]] SegmentationConfig getSegmentationConfig() const noexcept;

    // Set reconstruction configuration
    void setReconstructionConfig(const ReconstructionConfig& config);
    [[nodiscard]] ReconstructionConfig getReconstructionConfig() const noexcept;

    // Register a progress callback (ownership not transferred)
    void setProgressCallback(IModelingProgressCallback* callback) noexcept;

    // Generate 3D model from CT volume data
    // Throws ModelingEngineException on failure
    [[nodiscard]] std::unique_ptr<Model3D> generateModel(const CTVolumeData& ctData) const;

    // Reset all configuration to defaults
    void resetConfigurations() noexcept;

private:
    struct Impl;
    std::unique_ptr<Impl> pImpl_;
};

} // namespace modeling3d

#endif // MODELINGENGINE3D_H
```