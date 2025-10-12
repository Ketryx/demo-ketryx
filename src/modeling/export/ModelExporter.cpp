```cpp
#include "ModelExporter.h"
#include <fstream>
#include <sstream>
#include <iomanip>
#include <chrono>
#include <ctime>
#include <vector>
#include <map>
#include <zlib.h>           // For compression
#include <stdexcept>

namespace modeling {
namespace export_ {

ModelExporter::ModelExporter()
{
    // Default coordinate system: Right-Handed, Y-Up
    coordinateSystem_ = CoordinateSystem::RightHanded_YUp;
}

void ModelExporter::setCoordinateSystem(CoordinateSystem cs)
{
    coordinateSystem_ = cs;
}

void ModelExporter::embedMetadata(Metadata&& md)
{
    metadata_ = std::move(md);
}

bool ModelExporter::exportModel(const Model& model, const std::string& filepath, ExportFormat fmt) const
{
    Model adjustedModel = handleCoordinateSystem(model, coordinateSystem_);

    std::string rawData;
    switch (fmt)
    {
    case ExportFormat::STL:
        rawData = exportSTL(adjustedModel);
        break;
    case ExportFormat::OBJ:
        rawData = exportOBJ(adjustedModel);
        break;
    case ExportFormat::PLY:
        rawData = exportPLY(adjustedModel);
        break;
    case ExportFormat::DICOM_SEG:
        rawData = exportDICOMSeg(adjustedModel);
        break;
    default:
        throw std::invalid_argument("Unsupported export format");
    }

    std::string finalData = embedMetadataInData(rawData, fmt);

    std::string compressedData;
    compressData(finalData, compressedData);

    if (!writeFile(filepath, compressedData))
        return false;

    return validateExport(filepath, fmt);
}

bool ModelExporter::batchExport(const std::vector<Model>& models, const std::vector<std::string>& paths, ExportFormat fmt) const
{
    if (models.size() != paths.size())
        throw std::invalid_argument("Models and paths vectors must be the same size");

    for (size_t i = 0; i < models.size(); ++i)
    {
        if (!exportModel(models[i], paths[i], fmt))
            return false;
    }
    return true;
}

/* ----------------------- Internal Methods ----------------------- */

Model ModelExporter::handleCoordinateSystem(const Model& model, CoordinateSystem cs) const
{
    // Assume Model class has method to transform to coordinate system
    Model transformed = model;
    transformed.transformToCoordinateSystem(cs);
    return transformed;
}

std::string ModelExporter::exportSTL(const Model& model) const
{
    std::ostringstream oss;
    oss << "solid model_export\n";
    for (const auto& tri : model.getTriangles())
    {
        auto n = tri.normal;
        oss << "facet normal " << n.x << " " << n.y << " " << n.z << "\n";
        oss << "  outer loop\n";
        for (const auto& v : tri.vertices)
            oss << "    vertex " << v.x << " " << v.y << " " << v.z << "\n";
        oss << "  endloop\n";
        oss << "endfacet\n";
    }
    oss << "endsolid model_export\n";
    return oss.str();
}

std::string ModelExporter::exportOBJ(const Model& model) const
{
    std::ostringstream oss;
    const auto& verts = model.getVertices();
    const auto& normals = model.getNormals();
    const auto& faces = model.getFaces();

    for (const auto& v : verts)
        oss << "v " << v.x << " " << v.y << " " << v.z << "\n";
    for (const auto& n : normals)
        oss << "vn " << n.x << " " << n.y << " " << n.z << "\n";

    // Faces: OBJ uses 1-based indices
    for (const auto& f : faces)
    {
        oss << "f";
        for (const auto& idx : f.vertexIndices)
        {
            oss << " " << (idx + 1);
            if (!normals.empty())
                oss << "//" << (idx + 1);
        }
        oss << "\n";
    }

    return oss.str();
}

std::string ModelExporter::exportPLY(const Model& model) const
{
    const auto& verts = model.getVertices();
    const auto& faces = model.getFaces();

    std::ostringstream oss;
    oss << "ply\nformat ascii 1.0\n";
    oss << "element vertex " << verts.size() << "\n";
    oss << "property float x\nproperty float y\nproperty float z\n";
    oss << "element face " << faces.size() << "\n";
    oss << "property list uchar int vertex_indices\n";
    oss << "end_header\n";

    for (const auto& v : verts)
        oss << v.x << " " << v.y << " " << v.z << "\n";

    for (const auto& f : faces)
    {
        oss << f.vertexIndices.size();
        for (int idx : f.vertexIndices)
            oss << " " << idx;
        oss << "\n";
    }

    return oss.str();
}

std::string ModelExporter::exportDICOMSeg(const Model& model) const
{
    // DICOM-SEG export involves complex clinical format encoding,
    // here is a minimal placeholder representation embedding model geometry as metadata

    std::ostringstream oss;
    oss << "DICOM-SEG-Model\n";
    oss << "PatientID: " << metadata_.patientID << "\n";
    oss << "ScanDate: " << metadata_.scanDate << "\n";
    oss << "ModelVersion: " << metadata_.modelVersion << "\n";
    oss << "GeometryDataCount: " << model.getVertices().size() << "\n";
    // Minimal geometry export to keep format lightweight
    for (const auto& v : model.getVertices())
        oss << v.x << "," << v.y << "," << v.z << "\n";

    // Normally, proper DICOM SEG files require specialized libraries (dcmseg),
    // here is a simplified substitute.
    return oss.str();
}

std::string ModelExporter::embedMetadataInData(const std::string& data, ExportFormat fmt) const
{
    if (fmt == ExportFormat::DICOM_SEG)
        return data; // Metadata already embedded in DICOM-SEG export

    std::ostringstream oss;
    oss << "# Metadata\n";
    oss << "# PatientID: " << metadata_.patientID << "\n";
    oss << "# ScanDate: " << metadata_.scanDate << "\n";
    oss << "# ModelVersion: " << metadata_.modelVersion << "\n";
    oss << data;
    return oss.str();
}

void ModelExporter::compressData(const std::string& input, std::string& output) const
{
    constexpr size_t BUFSIZE = 128 * 1024;
    std::vector<char> buffer(BUFSIZE);

    z_stream strm{};
    deflateInit(&strm, Z_BEST_COMPRESSION);
    strm.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(input.data()));
    strm.avail_in = static_cast<uInt>(input.size());

    std::ostringstream oss;

    do {
        strm.next_out = reinterpret_cast<Bytef*>(buffer.data());
        strm.avail_out = BUFSIZE;
        deflate(&strm, Z_FINISH);
        size_t have = BUFSIZE - strm.avail_out;
        oss.write(buffer.data(), have);
    } while (strm.avail_out == 0);

    deflateEnd(&strm);
    output = oss.str();
}

bool ModelExporter::writeFile(const std::string& filepath, const std::string& data) const
{
    std::ofstream ofs(filepath, std::ios::binary);
    if (!ofs)
        return false;

    ofs.write(data.data(), static_cast<std::streamsize>(data.size()));
    return ofs.good();
}

bool ModelExporter::validateExport(const std::string& filepath, ExportFormat fmt) const
{
    std::ifstream ifs(filepath, std::ios::binary);
    if (!ifs)
        return false;

    // Minimal validation: check file not empty
    ifs.seekg(0, std::ios::end);
    auto size = ifs.tellg();
    if (size <= 0)
        return false;

    // For text formats, check for expected header
    if (fmt == ExportFormat::STL)
    {
        ifs.seekg(0);
        std::string line;
        std::getline(ifs, line);
        return (line.find("solid") != std::string::npos);
    }
    if (fmt == ExportFormat::OBJ)
    {
        ifs.seekg(0);
        std::string firstLine;
        std::getline(ifs, firstLine);
        return (firstLine.find("v ") != std::string::npos || firstLine.find("#") != std::string::npos);
    }
    if (fmt == ExportFormat::PLY)
    {
        ifs.seekg(0);
        std::string firstLine;
        std::getline(ifs, firstLine);
        return (firstLine == "ply");
    }
    if (fmt == ExportFormat::DICOM_SEG)
    {
        ifs.seekg(0);
        std::string firstLine;
        std::getline(ifs, firstLine);
        return (firstLine.find("DICOM-SEG-Model") != std::string::npos);
    }

    return true;
}

} // namespace export_
} // namespace modeling
```
