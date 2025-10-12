```cpp
#include "ModelingEngine3D.h"

#include <itkImage.h>
#include <itkImageFileReader.h>
#include <itkBinaryThresholdImageFilter.h>
#include <itkConnectedComponentImageFilter.h>
#include <itkRelabelComponentImageFilter.h>
#include <itkCastImageFilter.h>
#include <itkOrientImageFilter.h>

#include <vtkSmartPointer.h>
#include <vtkImageData.h>
#include <vtkMarchingCubes.h>
#include <vtkPolyData.h>
#include <vtkPolyDataNormals.h>
#include <vtkWindowedSincPolyDataFilter.h>
#include <vtkTriangleFilter.h>
#include <vtkCleanPolyData.h>
#include <vtkMassProperties.h>
#include <vtkXMLPolyDataWriter.h>
#include <vtkGPUVolumeRayCastMapper.h>
#include <vtkGPUInfoList.h>

#include <stdexcept>
#include <string>
#include <iostream>
#include <chrono>

namespace modeling3d
{

using CTImageType = itk::Image<short, 3>;
using MaskImageType = itk::Image<unsigned char, 3>;

ModelingEngine3D::ModelingEngine3D()
{
    // Initialize any GPU resources here if needed
}

ModelingEngine3D::~ModelingEngine3D() = default;

void ModelingEngine3D::LoadCTScan(const std::string& dicomDirectory)
{
    try
    {
        using ReaderType = itk::ImageSeriesReader<CTImageType>;
        using NamesGeneratorType = itk::GDCMImageIO;
        auto imageIO = itk::GDCMImageIO::New();
        auto reader = ReaderType::New();

        // Gather DICOM filenames from directory
        itk::GDCMSeriesFileNames::Pointer nameGenerator = itk::GDCMSeriesFileNames::New();
        nameGenerator->SetUseSeriesDetails(true);
        nameGenerator->AddSeriesRestriction("0008|0021");  // Series Date tag
        nameGenerator->SetDirectory(dicomDirectory);

        const auto & seriesUID = nameGenerator->GetSeriesUIDs();
        if (seriesUID.empty())
            throw std::runtime_error("No DICOM series found in directory: " + dicomDirectory);

        // Use first series found
        std::string seriesIdentifier = seriesUID[0];

        std::vector<std::string> fileNames = nameGenerator->GetFileNames(seriesIdentifier);

        if (fileNames.empty())
            throw std::runtime_error("No DICOM files found for series.");

        reader->SetImageIO(imageIO);
        reader->SetFileNames(fileNames);

        reader->Update();
        m_ctScan = reader->GetOutput();

        // Orient image to standard RAI
        auto orienter = itk::OrientImageFilter<CTImageType, CTImageType>::New();
        orienter->SetInput(m_ctScan);
        orienter->SetDesiredCoordinateOrientation(itk::SpatialOrientation::ITK_COORDINATE_ORIENTATION_RAI);
        orienter->Update();
        m_ctScan = orienter->GetOutput();

        std::cout << "CT scan loaded and oriented." << std::endl;
    }
    catch (const itk::ExceptionObject & ex)
    {
        throw std::runtime_error("ITK load error: " + std::string(ex.GetDescription()));
    }
    catch (const std::exception & ex)
    {
        throw;
    }
}

void ModelingEngine3D::SegmentCoronaryArteries()
{
    if (!m_ctScan)
        throw std::runtime_error("CT scan data not loaded.");

    try
    {
        // Threshold to isolate coronary arteries (example HU range)
        using ThresholdFilterType = itk::BinaryThresholdImageFilter<CTImageType, MaskImageType>;
        auto threshFilter = ThresholdFilterType::New();
        threshFilter->SetInput(m_ctScan);

        // Typical artery HU ~ 300 to 2500; adjust as appropriate
        threshFilter->SetLowerThreshold(300);
        threshFilter->SetUpperThreshold(2500);
        threshFilter->SetInsideValue(255);
        threshFilter->SetOutsideValue(0);
        threshFilter->Update();

        // Connected components to keep largest vessel tree only
        using ConnectedComponentFilterType = itk::ConnectedComponentImageFilter<MaskImageType, MaskImageType>;
        auto ccFilter = ConnectedComponentFilterType::New();
        ccFilter->SetInput(threshFilter->GetOutput());
        ccFilter->Update();

        using RelabelType = itk::RelabelComponentImageFilter<MaskImageType, MaskImageType>;
        auto relabelFilter = RelabelType::New();
        relabelFilter->SetInput(ccFilter->GetOutput());
        relabelFilter->Update();

        // Extract largest label (assumed to be coronary tree)
        auto relabeled = relabelFilter->GetOutput();
        m_vesselMask = MaskImageType::New();
        m_vesselMask->SetRegions(relabeled->GetLargestPossibleRegion());
        m_vesselMask->Allocate();
        m_vesselMask->FillBuffer(0);

        itk::ImageRegionConstIterator<MaskImageType> inIt(relabeled, relabeled->GetLargestPossibleRegion());
        itk::ImageRegionIterator<MaskImageType> outIt(m_vesselMask, m_vesselMask->GetLargestPossibleRegion());

        unsigned int largestLabel = 1;

        for (inIt.GoToBegin(), outIt.GoToBegin(); !inIt.IsAtEnd(); ++inIt, ++outIt)
            outIt.Set(inIt.Get() == largestLabel ? 255 : 0);

        std::cout << "Segmentation complete: coronary artery mask generated." << std::endl;
    }
    catch (const itk::ExceptionObject & ex)
    {
        throw std::runtime_error("ITK segmentation error: " + std::string(ex.GetDescription()));
    }
}

vtkSmartPointer<vtkImageData> ModelingEngine3D::ConvertITKToVTKImage(CTImageType* itkImage)
{
    using ConnectorType = itk::ImageToVTKImageFilter<CTImageType>;
    auto connector = ConnectorType::New();
    connector->SetInput(itkImage);
    try
    {
        connector->Update();
    }
    catch (const itk::ExceptionObject & ex)
    {
        throw std::runtime_error("Error converting ITK to VTK image: " + std::string(ex.GetDescription()));
    }
    return connector->GetOutput();
}

void ModelingEngine3D::SurfaceReconstruction()
{
    if (!m_vesselMask)
        throw std::runtime_error("Vessel segmentation mask not available.");

    auto vtkImage = ConvertITKToVTKImage(m_vesselMask.GetPointer());

    // Smooth mask to help marching cubes performance
    vtkSmartPointer<vtkWindowedSincPolyDataFilter> smoother;

    try
    {
        // Use marching cubes for surface extraction
        auto mc = vtkSmartPointer<vtkMarchingCubes>::New();
        mc->SetInputData(vtkImage);
        mc->ComputeNormalsOn();
        mc->SetValue(0, 127); // isosurface threshold for binary mask (0-255)

        mc->Update();

        // Clean triangles, enforce triangle polygon
        auto cleaner = vtkSmartPointer<vtkCleanPolyData>::New();
        cleaner->SetInputData(mc->GetOutput());
        cleaner->Update();

        auto triFilter = vtkSmartPointer<vtkTriangleFilter>::New();
        triFilter->SetInputData(cleaner->GetOutput());
        triFilter->Update();

        // Smooth mesh for model refinement
        smoother = vtkSmartPointer<vtkWindowedSincPolyDataFilter>::New();
        smoother->SetInputData(triFilter->GetOutput());
        smoother->SetNumberOfIterations(20);
        smoother->BoundarySmoothingOff();
        smoother->FeatureEdgeSmoothingOff();
        smoother->SetPassBand(0.1);
        smoother->Update();

        m_modelMesh = smoother->GetOutput();

        std::cout << "Surface reconstruction completed." << std::endl;
    }
    catch (const std::exception& e)
    {
        throw std::runtime_error(std::string("VTK surface reconstruction error: ") + e.what());
    }
}

void ModelingEngine3D::OptimizeMeshQuality()
{
    if (!m_modelMesh)
        throw std::runtime_error("Model mesh not generated.");

    try
    {
        // Apply smoothing (windowed sinc filter) again for quality
        auto smoother = vtkSmartPointer<vtkWindowedSincPolyDataFilter>::New();
        smoother->SetInputData(m_modelMesh);
        smoother->SetNumberOfIterations(15);
        smoother->BoundarySmoothingOn();
        smoother->FeatureEdgeSmoothingOn();
        smoother->SetPassBand(0.05);
        smoother->Update();

        // Replace model mesh with optimized mesh
        m_modelMesh = smoother->GetOutput();

        std::cout << "Mesh quality optimization completed." << std::endl;
    }
    catch (const std::exception& e)
    {
        throw std::runtime_error(std::string("VTK mesh optimization error: ") + e.what());
    }
}

double ModelingEngine3D::ValidateAgainstSourceData()
{
    if (!m_modelMesh || !m_ctScan)
        throw std::runtime_error("Model or CT data not ready for validation.");

    // Simple volumetric comparison as proxy for accuracy

    try
    {
        vtkSmartPointer<vtkMassProperties> massProp = vtkSmartPointer<vtkMassProperties>::New();
        massProp->SetInputData(m_modelMesh);
        double meshVolumeMM3 = massProp->GetVolume();

        // Calculate volume of segmented vessel from mask
        itk::ImageRegionConstIterator<MaskImageType> It(m_vesselMask, m_vesselMask->GetLargestPossibleRegion());

        SizeType size = m_vesselMask->GetLargestPossibleRegion().GetSize();
        const auto spacing = m_vesselMask->GetSpacing();

        double voxelVolume = spacing[0] * spacing[1] * spacing[2];

        unsigned long vesselVoxelCount = 0;
        for (It.GoToBegin(); !It.IsAtEnd(); ++It)
            if (It.Get() > 0)
                vesselVoxelCount++;

        double maskVolumeMM3 = vesselVoxelCount * voxelVolume;

        // Compute relative error
        double error = std::abs(meshVolumeMM3 - maskVolumeMM3) / maskVolumeMM3;

        std::cout << "Validation completed. Mesh volume: " << meshVolumeMM3
                  << " mm^3, Mask volume: " << maskVolumeMM3 << " mm^3, Relative error: " << error << std::endl;

        return error;
    }
    catch (const std::exception& e)
    {
        throw std::runtime_error(std::string("Validation error: ") + e.what());
    }
}

bool ModelingEngine3D::IsGPUAccelerationAvailable() const
{
    // Simple check for presence of any GPU device recognized by VTK GPU Volume Mapper
    vtkSmartPointer<vtkGPUInfoList> gpuList = vtkSmartPointer<vtkGPUInfoList>::New();
    gpuList->Update();

    return gpuList->GetNumberOfGPUs() > 0;
}

void ModelingEngine3D::EnableGPUAcceleration(bool enable)
{
    m_useGPU = enable && IsGPUAccelerationAvailable();

    if (!m_useGPU && enable)
        std::cerr << "Warning: GPU acceleration requested but no compatible GPU found. Falling back to CPU." << std::endl;
}

void ModelingEngine3D::ExportModel(const std::string& filename) const
{
    if (!m_modelMesh)
        throw std::runtime_error("Model mesh is empty, cannot export.");

    try
    {
        auto writer = vtkSmartPointer<vtkXMLPolyDataWriter>::New();
        writer->SetFileName(filename.c_str());
        writer->SetInputData(m_modelMesh);
        writer->SetDataModeToBinary();
        if (!writer->Write())
            throw std::runtime_error("Failed to write model file.");
    }
    catch (const std::exception& e)
    {
        throw std::runtime_error(std::string("Error exporting model: ") + e.what());
    }
}

} // namespace modeling3d
```
