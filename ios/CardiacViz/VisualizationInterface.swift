```swift
import UIKit
import SceneKit

@MainActor
final class VisualizationInterfaceViewController: UIViewController {
    // MARK: - UI Components
    
    private let sceneView = SCNView()
    private let loadingIndicator = UIActivityIndicatorView(style: .large)
    private let errorLabel = UILabel()
    private let annotationButton = UIButton(type: .system)
    private let measurementButton = UIButton(type: .system)
    private let toolbar = UIToolbar()
    
    // MARK: - Scene Elements
    
    private let heartNode = SCNNode()
    private var blockageNodes: [SCNNode] = []
    private var annotations: [Annotation] = []
    private var measurements: [Measurement] = []
    
    // Gesture state
    private var currentAngleY: Float = 0
    private var currentScale: Float = 1
    
    // MARK: - Services
    
    private let anomalyEngine = AnomalyDetectionEngine.shared
    
    // MARK: - Lifecycle
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        setupScene()
        setupGestures()
        fetchBlockageData()
    }
    
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        sceneView.frame = view.bounds
    }
    
    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        updateColorScheme()
    }
    
    // MARK: - Setup
    
    private func setupUI() {
        view.backgroundColor = .systemBackground
        
        sceneView.backgroundColor = .clear
        sceneView.allowsCameraControl = false
        sceneView.autoenablesDefaultLighting = true
        sceneView.translatesAutoresizingMaskIntoConstraints = false
        
        loadingIndicator.translatesAutoresizingMaskIntoConstraints = false
        
        errorLabel.translatesAutoresizingMaskIntoConstraints = false
        errorLabel.textColor = .systemRed
        errorLabel.textAlignment = .center
        errorLabel.numberOfLines = 0
        errorLabel.isHidden = true
        
        annotationButton.setTitle("Annotate", for: .normal)
        annotationButton.addTarget(self, action: #selector(didTapAnnotation), for: .touchUpInside)
        
        measurementButton.setTitle("Measure", for: .normal)
        measurementButton.addTarget(self, action: #selector(didTapMeasurement), for: .touchUpInside)
        
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        toolbar.items = [
            UIBarButtonItem(customView: annotationButton),
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
            UIBarButtonItem(customView: measurementButton)
        ]
        
        view.addSubview(sceneView)
        view.addSubview(loadingIndicator)
        view.addSubview(errorLabel)
        view.addSubview(toolbar)
        
        NSLayoutConstraint.activate([
            toolbar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            toolbar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            toolbar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),
            toolbar.heightAnchor.constraint(equalToConstant: 44),
            
            loadingIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            loadingIndicator.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            
            errorLabel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            errorLabel.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            errorLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }
    
    private func updateColorScheme() {
        let isDark = traitCollection.userInterfaceStyle == .dark
        sceneView.backgroundColor = isDark ? .black : .white
        annotationButton.tintColor = isDark ? .systemTeal : .systemBlue
        measurementButton.tintColor = isDark ? .systemTeal : .systemBlue
        errorLabel.textColor = isDark ? .systemRed : .systemRed
        view.backgroundColor = .systemBackground
        toolbar.barStyle = isDark ? .black : .default
    }
    
    private func setupScene() {
        let scene = SCNScene()
        sceneView.scene = scene
        
        // Setup camera
        let cameraNode = SCNNode()
        cameraNode.camera = SCNCamera()
        cameraNode.camera?.fieldOfView = 60
        cameraNode.position = SCNVector3(x: 0, y: 0, z: 15)
        scene.rootNode.addChildNode(cameraNode)
        
        // Setup lighting
        let omniLight = SCNLight()
        omniLight.type = .omni
        omniLight.intensity = 1000
        let lightNode = SCNNode()
        lightNode.light = omniLight
        lightNode.position = SCNVector3(x: 0, y: 10, z: 10)
        scene.rootNode.addChildNode(lightNode)
        
        // Load heart 3D model asynchronously
        Task {
            do {
                try await loadHeartModel()
            } catch {
                displayError("Failed to load 3D heart model.\n\(error.localizedDescription)")
            }
        }
    }
    
    private func setupGestures() {
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        let rotate = UIRotationGestureRecognizer(target: self, action: #selector(handleRotation(_:)))
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        
        sceneView.addGestureRecognizer(pinch)
        sceneView.addGestureRecognizer(rotate)
        sceneView.addGestureRecognizer(pan)
    }
    
    // MARK: - Data Loading
    
    private func fetchBlockageData() {
        loadingIndicator.startAnimating()
        errorLabel.isHidden = true
        Task {
            do {
                let blockageData = try await anomalyEngine.fetchBlockageData()
                try await MainActor.run {
                    self.loadingIndicator.stopAnimating()
                    self.updateBlockageOverlay(with: blockageData)
                }
            } catch {
                await MainActor.run {
                    self.loadingIndicator.stopAnimating()
                    self.displayError("Failed to fetch blockage data.\n\(error.localizedDescription)")
                }
            }
        }
    }
    
    private func updateBlockageOverlay(with data: [Blockage]) {
        blockageNodes.forEach { $0.removeFromParentNode() }
        blockageNodes.removeAll()
        
        for blockage in data {
            let sphere = SCNSphere(radius: 0.15)
            sphere.firstMaterial?.diffuse.contents = UIColor.systemRed.withAlphaComponent(0.8)
            sphere.firstMaterial?.emission.contents = UIColor.systemRed
            
            let node = SCNNode(geometry: sphere)
            node.position = SCNVector3(blockage.position.x, blockage.position.y, blockage.position.z)
            node.name = "blockage"
            
            // Animation for highlight
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 0.6
            pulse.toValue = 1.0
            pulse.duration = 1.5
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            node.addAnimation(pulse, forKey: "pulse")
            
            heartNode.addChildNode(node)
            blockageNodes.append(node)
        }
    }
    
    private func loadHeartModel() async throws {
        guard let url = Bundle.main.url(forResource: "heart", withExtension: "scn") else {
            throw NSError(domain: "ModelLoad", code: 1, userInfo: [NSLocalizedDescriptionKey: "Heart model resource missing"])
        }
        
        let sceneSource = SCNSceneSource(url: url, options: nil)
        guard let scene = try await sceneSource?.scene(options: nil) else {
            throw NSError(domain: "ModelLoad", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to load scene from source"])
        }
        
        if let heartModel = scene.rootNode.childNodes.first {
            heartNode.removeFromParentNode()
            heartNode.geometry = nil
            heartNode.childNodes.forEach { $0.removeFromParentNode() }
            heartNode.name = "heart"
            heartNode.position = SCNVector3Zero
            heartNode.eulerAngles = SCNVector3Zero
            
            for child in scene.rootNode.childNodes {
                heartNode.addChildNode(child)
            }
            sceneView.scene?.rootNode.addChildNode(heartNode)
        }
    }
    
    // MARK: - Gesture Handlers
    
    @objc private func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
        switch recognizer.state {
        case .changed, .began:
            let scale = Float(recognizer.scale)
            let newScale = currentScale * scale
            heartNode.scale = SCNVector3(x: newScale, y: newScale, z: newScale)
        case .ended:
            currentScale = heartNode.scale.x
        default:
            break
        }
    }
    
    @objc private func handleRotation(_ recognizer: UIRotationGestureRecognizer) {
        switch recognizer.state {
        case .began, .changed:
            let rotation = Float(recognizer.rotation)
            heartNode.eulerAngles.y = currentAngleY + rotation
        case .ended:
            currentAngleY = heartNode.eulerAngles.y
        default:
            break
        }
    }
    
    @objc private func handlePan(_ recognizer: UIPanGestureRecognizer) {
        guard recognizer.numberOfTouches == 1 else { return }
        let translation = recognizer.translation(in: sceneView)
        let sensitivity: Float = 0.005
        
        switch recognizer.state {
        case .changed, .began:
            heartNode.eulerAngles.x -= Float(translation.y) * sensitivity
            heartNode.eulerAngles.y -= Float(translation.x) * sensitivity
            recognizer.setTranslation(.zero, in: sceneView)
        default:
            break
        }
    }
    
    // MARK: - Clinician Tools
    
    @objc private func didTapAnnotation() {
        let alert = UIAlertController(title: "Add Annotation", message: "Tap on the model to place an annotation.", preferredStyle: .alert)
        alert.addTextField { $0.placeholder = "Annotation text" }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Add", style: .default) { [weak self] _ in
            guard let text = alert.textFields?.first?.text, !text.isEmpty else { return }
            self?.addAnnotation(text)
        })
        present(alert, animated: true)
    }
    
    private func addAnnotation(_ text: String) {
        // For demo, place annotation in front of camera
        let annotationNode = SCNNode()
        let textGeometry = SCNText(string: text, extrusionDepth: 0.5)
        textGeometry.font = UIFont.preferredFont(forTextStyle: .caption1)
        textGeometry.firstMaterial?.diffuse.contents = UIColor.systemYellow
        textGeometry.alignmentMode = CATextLayerAlignmentMode.center.rawValue
        textGeometry.flatness = 0.1
        
        annotationNode.geometry = textGeometry
        annotationNode.scale = SCNVector3(0.01, 0.01, 0.01)
        annotationNode.position = SCNVector3(0, 0, 2)
        annotationNode.name = "annotation"
        
        heartNode.addChildNode(annotationNode)
        annotations.append(Annotation(text: text, node: annotationNode))
    }
    
    @objc private func didTapMeasurement() {
        let alert = UIAlertController(title: "Measurement", message: "Measure distances by tapping two points on the model. (Feature coming soon)", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
    
    // MARK: - Error Handling
    
    private func displayError(_ message: String) {
        errorLabel.text = message
        errorLabel.isHidden = false
    }
}

// MARK: - Data Models

struct Blockage {
    let position: SIMD3<Float>
}

struct Annotation {
    let text: String
    let node: SCNNode
}

struct Measurement {
    let start: SIMD3<Float>
    let end: SIMD3<Float>
    let distance: Float
}

// MARK: - AnomalyDetectionEngine Mockup

final class AnomalyDetectionEngine {
    static let shared = AnomalyDetectionEngine()
    
    private init() { }
    
    func fetchBlockageData() async throws -> [Blockage] {
        try await Task.sleep(nanoseconds: 1_200_000_000)
        // Return mock blockage data around a heart model roughly centered at origin
        [
            Blockage(position: SIMD3<Float>(0.6, 0.2, 0.0)),
            Blockage(position: SIMD3<Float>(-0.5, -0.3, 0.1)),
            Blockage(position: SIMD3<Float>(0.0, 0.5, -0.4))
        ]
    }
}
```