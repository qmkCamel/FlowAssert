/** Pure transformation; the loader validates version and bytes before calling it. */
export function rewriteLoopbackBinding(source) {
  const site = 'this.localServer.listen(this.localport);'
  if (source.split(site).length !== 2) throw new Error('mobile_mirror_ios_forwarder_unsupported')
  return source.replace(site, "this.localServer.listen({port: this.localport, host: '127.0.0.1'});")
}
