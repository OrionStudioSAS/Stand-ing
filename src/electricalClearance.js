export function electricalWallClearance(item = {}) {
  const text = `${item.type || ''} ${item.label || ''} ${item.options?.variantGroupLabel || ''}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-_]/g, ' ');
  const explicit = item.dimensions?.containsElectricalBox || item.dimensions?.isElectricalBox;
  const box = /\bcoffret\b|electrical (?:cabinet|box)|distribution box|cache compteur|bloc 3 etageres/.test(text);
  const cabinet = /\barmoire\b/.test(text) && (/electri/.test(text) || item.children?.some(child => electricalWallClearance(child) > 0));
  return explicit || box || cabinet ? .025 : 0;
}

export function applyElectricalClearance(items = [], width, depth, layout = 'back') {
  const leaves = [];
  const collect = (item, parent = { x: 0, z: 0, rotation: 0 }) => {
    const angle = parent.rotation * Math.PI / 180;
    const x = parent.x + Number(item.x || 0) * Math.cos(angle) + Number(item.z || 0) * Math.sin(angle);
    const z = parent.z - Number(item.x || 0) * Math.sin(angle) + Number(item.z || 0) * Math.cos(angle);
    const transform = { x, z, rotation: parent.rotation + Number(item.rotation || 0) };
    if (item.isGroup && item.children?.length) item.children.forEach(child => collect(child, transform));
    else leaves.push({ item, parent, transform, box: electricalItemBounds(item, transform) });
  };
  items.forEach(item => collect(item));
  const walls = leaves.filter(({ item, box }) => {
    const text = `${item.type} ${item.label}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const height=Number(item.dimensions?.size?.[1] || item.modelSize?.[1] || 0);
    return height>=1.8 && !text.includes('tete') && /cloison|porte|partition|door/.test(text) && Math.min(box.maxX-box.minX,box.maxZ-box.minZ) <= .2;
  });
  const changes = new Map();
  for (const leaf of leaves) {
    const gap = electricalWallClearance(leaf.item);
    if (!gap) continue;
    const { box, transform, parent } = leaf;
    const bounds = { minX: -width/2 + (layout==='left'||layout==='u'?.06:0), maxX: width/2 - (layout==='right'||layout==='u'?.06:0), minZ: -depth/2+.06, maxZ: depth/2 };
    const allowed = electricalClearanceRect(bounds, bounds, layout, gap);
    let minX=allowed.minX-(box.minX-transform.x),maxX=allowed.maxX-(box.maxX-transform.x);
    let minZ=allowed.minZ-(box.minZ-transform.z),maxZ=allowed.maxZ-(box.maxZ-transform.z);
    for (const wall of walls) {
      const w=wall.box;
      if (w.maxX-w.minX < w.maxZ-w.minZ) {
        if (box.maxZ <= w.minZ || box.minZ >= w.maxZ) continue;
        if (transform.x >= (w.minX+w.maxX)/2) minX=Math.max(minX,w.maxX+gap-(box.minX-transform.x));
        else maxX=Math.min(maxX,w.minX-gap-(box.maxX-transform.x));
      } else {
        if (box.maxX <= w.minX || box.minX >= w.maxX) continue;
        if (transform.z >= (w.minZ+w.maxZ)/2) minZ=Math.max(minZ,w.maxZ+gap-(box.minZ-transform.z));
        else maxZ=Math.min(maxZ,w.minZ-gap-(box.maxZ-transform.z));
      }
    }
    const fit = (value,min,max) => min<=max+1e-9 ? Math.max(min,Math.min(max,value)) : value;
    const x=fit(transform.x,minX,maxX),z=fit(transform.z,minZ,maxZ);
    if (Math.abs(x-transform.x)<1e-9 && Math.abs(z-transform.z)<1e-9) continue;
    const angle=parent.rotation*Math.PI/180;
    // Update only the interior object, never the manually assembled reserve structure.
    changes.set(leaf.item,{...leaf.item,x:(x-parent.x)*Math.cos(angle)-(z-parent.z)*Math.sin(angle),z:(x-parent.x)*Math.sin(angle)+(z-parent.z)*Math.cos(angle)});
  }
  const replace = item => changes.get(item) || (item.isGroup && item.children?.length ? {...item,children:item.children.map(replace)} : item);
  return changes.size ? items.map(replace) : items;
}

function electricalItemBounds(item, transform) {
  const size=item.dimensions?.size || item.modelSize || [.7,.7,.7];
  const frame=item.dimensions?.depthLocked6cm && item.dimensions?.wallCoverFrameBounds;
  const bounds=frame || {minX:-size[0]/2,maxX:size[0]/2,minZ:-size[2]/2,maxZ:size[2]/2};
  const angle=transform.rotation*Math.PI/180;
  const points=[[bounds.minX,bounds.minZ],[bounds.minX,bounds.maxZ],[bounds.maxX,bounds.minZ],[bounds.maxX,bounds.maxZ]]
    .map(([x,z])=>({x:transform.x+x*Math.cos(angle)+z*Math.sin(angle),z:transform.z-x*Math.sin(angle)+z*Math.cos(angle)}));
  return {minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))};
}

export function electricalClearanceRect(rect, bounds, layout, clearance = 0) {
  if (!clearance) return rect;
  return {
    ...rect,
    minX: layout === 'left' || layout === 'u' ? Math.max(rect.minX, bounds.minX + clearance) : rect.minX,
    maxX: layout === 'right' || layout === 'u' ? Math.min(rect.maxX, bounds.maxX - clearance) : rect.maxX,
    minZ: Math.max(rect.minZ, bounds.minZ + clearance),
  };
}
