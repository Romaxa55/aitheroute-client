export const guest = `
import assert from 'node:assert/strict'
import {networkInterfaces,userInfo} from 'node:os'
import {Resolver} from 'node:dns/promises'
import {createSocket} from 'node:dgram'
import {connect} from 'node:net'
import {once} from 'node:events'
import {access} from 'node:fs/promises'
import {createServer as httpServer} from 'node:http'
import {spawn} from 'node:child_process'
const unreachable=port=>new Promise((ok,fail)=>{
 const c=connect(port); c.once('error',ok);c.once('connect',()=>{c.destroy();fail(Error('direct connection'))})
})
assert.deepEqual(Object.keys(networkInterfaces()),['lo'])
assert.equal(userInfo().homedir,'/home/route')
await unreachable({host:'198.51.100.1',port:443})
await unreachable({host:'2001:db8::1',port:443})
await unreachable({host:'127.0.0.1',port:Number(process.argv[1])})
for(const [family,host] of [['udp4','198.51.100.1'],['udp6','2001:db8::1']]){
  const udp=createSocket(family)
  const err=await new Promise(ok=>udp.send(Buffer.from('route-test'),443,host,ok))
  assert.ok(['ENETUNREACH','EHOSTUNREACH','EADDRNOTAVAIL'].includes(err?.code))
  udp.close()
}
const dns=new Resolver({timeout:200,tries:1});dns.setServers(['198.51.100.1'])
await assert.rejects(dns.resolve4('strict-test.invalid'))
await assert.rejects(access('/run/dbus/system_bus_socket'))
const callback=httpServer();callback.listen(0,'127.0.0.1')
await once(callback,'listening')
const receiving=once(callback,'request')
const url='http://127.0.0.1:'+callback.address().port+'/callback?code=synthetic'
const tab=spawn('/usr/lib/chromium/chromium',['--user-data-dir=/tmp/browser','--',url],{stdio:'ignore'})
tab.once('error',e=>{throw e})
const [req,res]=await receiving
assert.match(req.headers['user-agent'],/Chrome|Chromium/)
assert.equal(req.url,'/callback?code=synthetic')
res.writeHead(200,{connection:'close'}).end('OAuth callback received')
callback.close()
process.exitCode=9
`

export const cancelBrowser = `
        import {readFile,readdir} from 'node:fs/promises'
        let killed=false
        for(const entry of await readdir('/proc')){
          if(!/^\\d+$/.test(entry)||Number(entry)===process.pid)continue
          const args=await readFile('/proc/'+entry+'/cmdline','utf8').catch(()=>'')
          const name=await readFile('/proc/'+entry+'/comm','utf8').catch(()=>'')
          if(name.trim()==='chromium' && !args.includes('--type=')){
            process.kill(Number(entry),'SIGKILL');killed=true;break
          }
        }
        if(!killed)process.exit(72)
        setTimeout(()=>process.exit(73),4000)

`
