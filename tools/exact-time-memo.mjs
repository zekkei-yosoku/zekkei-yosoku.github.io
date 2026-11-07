// Cache only observer-independent ephemerides at their EXACT numeric timestamp.
// No time bins, interpolation or saved observer/atmosphere state. Results consist
// of scalar numbers; copy on return preserves the public functions' fresh objects.
export function createExactTimeMemo(compute,limit=4096){
 const values=new Map();
 return ms=>{
  // Keep the original coercion/error behavior for Date, strings and invalid input.
  if(!Number.isFinite(ms)||Object.is(ms,-0))return compute(ms);
  let value=values.get(ms);
  if(value!==undefined)values.delete(ms);
  else value=compute(ms);
  values.set(ms,value);
  while(values.size>limit)values.delete(values.keys().next().value);
  return {...value};
 };
}
