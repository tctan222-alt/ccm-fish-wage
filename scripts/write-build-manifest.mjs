import { createHash } from 'node:crypto'
import console from 'node:console'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { readdirSync,readFileSync,writeFileSync } from 'node:fs'
import path from 'node:path'

// Public, read-only release provenance. No credentials or business data are read.
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
const commit=git('rev-parse','HEAD')
if(!/^[0-9a-f]{40}$/.test(commit))throw new Error('Build requires an identifiable source commit.')
const expected=process.env.CCM_RELEASE_COMMIT
if(expected&&expected!==commit)throw new Error('Requested release commit does not match checkout.')
const dirty=git('status','--porcelain')!==''
if(expected&&dirty)throw new Error('Formal release build requires a clean source tree, including untracked files.')
const dist=path.resolve('dist')
const files=[]
function visit(directory){
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    const filename=path.join(directory,entry.name)
    if(entry.isDirectory())visit(filename)
    else if(entry.isFile()&&entry.name!=='release.json')files.push({
      path:path.relative(dist,filename).split(path.sep).join('/'),
      sha256:createHash('sha256').update(readFileSync(filename)).digest('hex'),
    })
  }
}
visit(dist)
files.sort((a,b)=>a.path.localeCompare(b.path))
const manifest={schemaVersion:1,commit,dirty,builtAt:new Date().toISOString(),files}
writeFileSync(path.join(dist,'release.json'),JSON.stringify(manifest,null,2)+'\n')
console.log(`Release manifest: ${commit}${dirty?' (development tree)':''}; ${files.length} files`)
