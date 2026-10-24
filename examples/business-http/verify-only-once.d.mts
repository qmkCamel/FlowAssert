export default function verifyOnlyOnce(input: { base: string; id: string; expectedAmount: number; owner: string; windowMs?: number }): Promise<{
  verdict: 'pass' | 'fail' | 'inconclusive'; expected: string; actual: string; source: string; readAt: string; artifactRefs: string[]
}>
