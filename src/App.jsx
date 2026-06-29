import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { fetchModel, buildMeshes } from './onshape.js'

export default function App() {
  const canvasRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('Enter an Onshape Part Studio URL')

  useEffect(() => {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)
    sceneRef.current = scene
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    camera.position.set(0, 0, 5)
    cameraRef.current = camera
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current })
    renderer.setSize(window.innerWidth, window.innerHeight)
    const ambient = new THREE.AmbientLight(0xffffff, 0.5)
    scene.add(ambient)
    const dirLight = new THREE.DirectionalLight(0xffffff, 1)
    dirLight.position.set(5, 10, 7)
    scene.add(dirLight)
    let animId
    const animate = () => { animId = requestAnimationFrame(animate); renderer.render(scene, camera) }
    animate()
    const onResize = () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight) }
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', onResize); renderer.dispose() }
  }, [])

  async function handleLoad() {
    try {
      setStatus('Loading model...')
      const data = await fetchModel(url)
      const meshes = buildMeshes(data)
      sceneRef.current.children.filter(c => c.isMesh).forEach(m => sceneRef.current.remove(m))
      meshes.forEach(m => sceneRef.current.add(m))
      if (meshes.length > 0) {
        const box = new THREE.Box3()
        meshes.forEach(m => box.expandByObject(m))
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        cameraRef.current.position.set(center.x, center.y, center.z + maxDim * 2)
        cameraRef.current.lookAt(center)
      }
      setStatus('Loaded ' + meshes.length + ' faces')
    } catch (err) {
      console.error(err)
      setStatus('Error: ' + err.message)
    }
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      <div style={{ position: 'absolute', top: 20, left: 20, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste Onshape Part Studio URL..." style={{ width: 420, padding: '8px 12px', borderRadius: 6, border: 'none', fontSize: 14 }} />
        <button onClick={handleLoad} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#4a9eff', color: 'white', cursor: 'pointer', fontSize: 14 }}>Load</button>
        <span style={{ color: 'white', fontSize: 13 }}>{status}</span>
      </div>
    </div>
  )
}
