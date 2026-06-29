import * as THREE from 'three'

export function parseOnshapeUrl(url) {
  const match = url.match(/documents\/([a-f0-9]+)\/(w|v|m)\/([a-f0-9]+)\/e\/([a-f0-9]+)/)
  if (!match) throw new Error('Invalid Onshape URL')
  return { did: match[1], wvmType: match[2], wid: match[3], eid: match[4] }
}

export async function fetchModel(url) {
  const { did, wvmType, wid, eid } = parseOnshapeUrl(url)
  const res = await fetch(`http://localhost:3001/api/model?did=${did}&wvmType=${wvmType}&wid=${wid}&eid=${eid}`)
  if (!res.ok) throw new Error('Backend request failed')
  return res.json()
}

export function buildMeshes(tessData) {
  const meshes = []
  for (const body of tessData.bodies ?? []) {
    for (const face of body.faces ?? []) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(face.vertices), 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(face.normals), 3))
      if (face.indices) geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(face.indices), 1))
      const material = new THREE.MeshStandardMaterial({ color: 0x888888, side: THREE.DoubleSide })
      meshes.push(new THREE.Mesh(geometry, material))
    }
  }
  return meshes
}
