// Read only the part of the painted timeline the user can see. The native
// ruler scrolls a wide canvas while the preview paints directly into the viewport.
async function timebarPixels(page,selector,colours){
 return page.locator(selector).evaluate((root,colours)=>{
  const box=root.getBoundingClientRect();
  const layer=[...root.querySelectorAll('.sky-timeline-annotations,.sky-minute-ruler')]
   .find(canvas=>!canvas.hidden&&canvas.getBoundingClientRect().width>0&&canvas.width>0&&canvas.height>0);
  const pixels=Object.fromEntries(Object.keys(colours).map(name=>[name,[]]));
  const scale=AstroNotesScrollTimeline.scale(root.dataset.mode);
  const output={mode:root.dataset.mode,at:Number(root.getAttribute('aria-valuenow')),
   axis:box.left+root.clientWidth/2,rate:scale.pixels/scale.step,pixels,layer:layer?.className};
  if(!layer)return output;
  const bounds=layer.getBoundingClientRect(),image=layer.getContext('2d').getImageData(0,0,layer.width,layer.height);
  const step=bounds.width/image.width;
  // Only sample the bottom annotations region, even on a full-height canvas.
  const firstRow=Math.max(0,Math.floor(image.height*(1-16/bounds.height)));
  for(let x=0;x<image.width;x++){
   const screen=bounds.left+(x+.5)*step;
   if(screen<box.left||screen>box.right)continue;
   for(const [name,[r,g,b]] of Object.entries(colours)){
    for(let y=firstRow;y<image.height;y++){
     const i=(y*image.width+x)*4;
     if(image.data[i+3]>240&&image.data[i]===r&&image.data[i+1]===g&&image.data[i+2]===b){pixels[name].push(screen);break;}
    }
   }
  }
  return output;
 },colours);
}
module.exports=timebarPixels;
