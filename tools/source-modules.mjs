// Source units declare their dependencies with one import statement per unit at the head and one export statement at the tail.
// A long name list may wrap over several lines (tools/sync-module-lines.cjs wraps at 200 characters).
// Delivery still concatenates classic scripts, so assembly removes exactly those lines and nothing else.
const IMPORT=/^import \{[^}]*\} from '[^'\n]+';\n/,EXPORT=/(^|\n)export \{[^}]*\};\n?$/;
export function stripModuleSyntax(code){
 let out=code;
 while(IMPORT.test(out))out=out.replace(IMPORT,'');
 return out.replace(EXPORT,(m,lead)=>m.endsWith('\n')?lead:'');
}
