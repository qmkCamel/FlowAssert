import { randomUUID } from 'node:crypto'
export const externalFixture = () => ({ contractVersion: 1, requestKey: randomUUID(), adapter: 'junit', engine: 'synthetic-junit', engineVersion: '1', report: Buffer.from('<testsuite><testcase name="private-test"><system-out>private-secret</system-out></testcase></testsuite>').toString('base64') })
