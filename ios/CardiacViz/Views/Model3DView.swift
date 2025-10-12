```swift
import SwiftUI
import SceneKit
import Combine

struct Model3DView: UIViewRepresentable {
    @Binding var modelData: Data?
    @Binding var isLoading: Bool
    
    class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var sceneView: SCNView
        var lastPanLocation = CGPoint.zero
        var lastRotation: Float = 0
        var lastScale: CGFloat = 1.0
        
        init(sceneView: SCNView) {
            self.sceneView = sceneView
            super.init()
            setupGestures()
        }
        
        private func setupGestures() {
            let panGesture = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
            panGesture.maximumNumberOfTouches = 1
            panGesture.delegate = self
            sceneView.addGestureRecognizer(panGesture)
            
            let rotationGesture = UIRotationGestureRecognizer(target: self, action: #selector(handleRotation(_:)))
            rotationGesture.delegate = self
            sceneView.addGestureRecognizer(rotationGesture)
            
            let pinchGesture = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
            pinchGesture.delegate = self
            sceneView.addGestureRecognizer(pinchGesture)
        }
        
        @objc func handlePan(_ gesture: UIPanGestureRecognizer) {
            guard let node = sceneView.scene?.rootNode.childNode(withName: "coronaryModel", recursively: true) else { return }
            let translation = gesture.translation(in: sceneView)
            
            // Rotate model around Y and X axes based on pan
            let deltaX = Float(translation.x - lastPanLocation.x) * 0.005
            let deltaY = Float(translation.y - lastPanLocation.y) * 0.005
            
            var newX = node.eulerAngles.x - deltaY
            var newY = node.eulerAngles.y - deltaX
            
            // Clamp X rotation between -90 to 90 degrees to avoid flipping
            newX = min(max(newX, -.pi/2), .pi/2)
            
            node.eulerAngles.x = newX
            node.eulerAngles.y = newY
            
            lastPanLocation = translation
            
            if gesture.state == .ended || gesture.state == .cancelled || gesture.state == .failed {
                lastPanLocation = .zero
            }
        }
        
        @objc func handleRotation(_ gesture: UIRotationGestureRecognizer) {
            guard let node = sceneView.scene?.rootNode.childNode(withName: "coronaryModel", recursively: true) else { return }
            if gesture.state == .began || gesture.state == .changed {
                let delta = Float(gesture.rotation - CGFloat(lastRotation))
                node.eulerAngles.z -= delta
                lastRotation = Float(gesture.rotation)
            } else {
                lastRotation = 0
            }
        }
        
        @objc func handlePinch(_ gesture: UIPinchGestureRecognizer) {
            guard let cameraNode = sceneView.pointOfView else { return }
            let zoomSpeed: Float = 5
            
            switch gesture.state {
            case .changed:
                let deltaScale = Float(gesture.scale / lastScale)
                let newZ = cameraNode.position.z / deltaScale
                // Clamp camera zoom: between 10 and 150 units
                cameraNode.position.z = min(max(newZ, 10), 150)
                lastScale = gesture.scale
                
            case .ended, .cancelled, .failed:
                lastScale = 1.0
                
            default:
                break
            }
        }
        
        // Allow simultaneous gesture recognition for better UX
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            true
        }
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(sceneView: sceneView)
    }
    
    private let sceneView = SCNView(frame: .zero, options: [
        SCNView.Option.preferredRenderingAPI.rawValue: SCNRenderingAPI.metal.rawValue // best performance
    ])
    
    func makeUIView(context: Context) -> SCNView {
        sceneView.backgroundColor = UIColor { traitCollection in
            traitCollection.userInterfaceStyle == .dark ? UIColor.black : UIColor.white
        }
        sceneView.allowsCameraControl = false
        sceneView.autoenablesDefaultLighting = false
        sceneView.antialiasingMode = .multisampling4X
        sceneView.isPlaying = true
        sceneView.delegate = context.coordinator
        
        setupScene()
        context.coordinator.sceneView = sceneView // ensure coordinator references the view
        
        return sceneView
    }
    
    func updateUIView(_ uiView: SCNView, context: Context) {
        if let data = modelData, !isLoading {
            loadModel(from: data, in: uiView.scene)
        }
        // Update background color for dark mode changes
        uiView.backgroundColor = UIColor { traitCollection in
            traitCollection.userInterfaceStyle == .dark ? UIColor.black : UIColor.white
        }
    }
    
    private func setupScene() {
        let scene = SCNScene()
        sceneView.scene = scene
        
        // Camera
        let cameraNode = SCNNode()
        cameraNode.name = "camera"
        cameraNode.camera = SCNCamera()
        cameraNode.camera?.fieldOfView = 60
        cameraNode.position = SCNVector3(x: 0, y: 0, z: 80)
        cameraNode.camera?.zNear = 0.1
        cameraNode.camera?.zFar = 500
        scene.rootNode.addChildNode(cameraNode)
        sceneView.pointOfView = cameraNode
        
        setupLighting(in: scene)
    }
    
    private func setupLighting(in scene: SCNScene) {
        // Key light: bright white light from front-top-right
        let keyLight = SCNLight()
        keyLight.type = .directional
        keyLight.color = UIColor(white: 1.0, alpha: 1.0)
        keyLight.intensity = 950
        let keyLightNode = SCNNode()
        keyLightNode.light = keyLight
        keyLightNode.position = SCNVector3(30, 40, 50)
        keyLightNode.eulerAngles = SCNVector3(-.pi/4, .pi/4, 0)
        scene.rootNode.addChildNode(keyLightNode)
        
        // Fill light: softer blueish light from left-bottom
        let fillLight = SCNLight()
        fillLight.type = .ambient
        fillLight.color = UIColor(red: 0.3, green: 0.4, blue: 0.55, alpha: 0.4)
        let fillLightNode = SCNNode()
        fillLightNode.light = fillLight
        scene.rootNode.addChildNode(fillLightNode)
        
        // Back light: subtle rim light from behind to highlight edges
        let backLight = SCNLight()
        backLight.type = .directional
        backLight.color = UIColor(white: 0.3, alpha: 0.3)
        let backLightNode = SCNNode()
        backLightNode.light = backLight
        backLightNode.position = SCNVector3(-20, 0, -40)
        backLightNode.eulerAngles = SCNVector3(.pi/6, -.pi/3, 0)
        scene.rootNode.addChildNode(backLightNode)
    }
    
    private func loadModel(from data: Data, in scene: SCNScene?) {
        guard let scene = scene else { return }
        // Remove existing coronary model node if any
        scene.rootNode.childNode(withName: "coronaryModel", recursively: true)?.removeFromParentNode()
        
        // Attempt to load model from given data
        // Assuming GLTF or USDZ format for coronary arteries 3D model
        
        let tempURL = URL(fileURLWithPath: NSTemporaryDirectory())
                            .appendingPathComponent("coronary_temp_model")
        
        do {
            try data.write(to: tempURL)
            let modelScene = try SCNScene(url: tempURL, options: [
                SCNSceneSource.LoadingOption.preferredRenderingAPI.rawValue: SCNRenderingAPI.metal.rawValue
            ])
            
            let modelRootNode = SCNNode()
            modelRootNode.name = "coronaryModel"
            
            for child in modelScene.rootNode.childNodes {
                modelRootNode.addChildNode(child)
            }
            
            // Center model bounding box at origin
            let (minVec, maxVec) = modelRootNode.boundingBox
            let centerOffset = SCNVector3(
                (minVec.x + maxVec.x) / 2,
                (minVec.y + maxVec.y) / 2,
                (minVec.z + maxVec.z) / 2
            )
            modelRootNode.position = SCNVector3(
                -centerOffset.x,
                -centerOffset.y,
                -centerOffset.z
            )
            
            // Apply subtle material tweak: slightly glossy for vessel realism
            modelRootNode.enumerateChildNodes { node, _ in
                if let mat = node.geometry?.firstMaterial {
                    mat.lightingModel = .physicallyBased
                    mat.roughness.contents = 0.4
                    mat.metalness.contents = 0.1
                    mat.diffuse.contentsTransform = SCNMatrix4MakeScale(1, 1, 1)
                    mat.diffuse.wrapS = .repeat
                    mat.diffuse.wrapT = .repeat
                }
            }
            
            scene.rootNode.addChildNode(modelRootNode)
            
        } catch {
            // Silently ignore failures, fallback or trigger reload externally
            #if DEBUG
            print("Failed to load 3D model: \(error)")
            #endif
        }
        
        // Cleanup temp file
        try? FileManager.default.removeItem(at: tempURL)
    }
}
```