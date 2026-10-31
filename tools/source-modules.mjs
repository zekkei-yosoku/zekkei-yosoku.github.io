// Source units declare their dependencies with one import line per unit at the head and one export line at the tail.
// Delivery still concatenates classic scripts, so assembly removes exactly those lines and nothing else.
const IMPORT=/^import \{[^}\n]*\} from '[^'\n]+';\n/,EXPORT=/(^|\n)export \{[^}\n]*\};\n?$/;
export function stripModuleSyntax(code){
 let out=code;
 while(IMPORT.test(out))out=out.replace(IMPORT,'');
 return out.replace(EXPORT,(m,lead)=>m.endsWith('\n')?lead:'');
}
