import { mirrorWorkspaceCredit } from '../credits/workspace_credit_mirror'

describe('mirrorWorkspaceCredit', () => {
  it('uses the account owner ID as the corresponding workspace and copies authoritative account values', async () => {
    const upsert = jest.fn()
    const tx = { workspaceCredit: { upsert } } as any
    const account = {
      userId: 'user-1',
      balance: 15312,
      lifetimeGranted: 60000,
      lifetimeUsed: 11846,
      windowStartedAt: new Date('2026-11-01T02:41:25.799Z'),
    }

    await mirrorWorkspaceCredit(tx, account)

    expect(upsert).toHaveBeenCalledWith({
      where: { workspaceId: 'user-1' },
      create: { workspaceId: 'user-1', balance: 15312, lifetimeGranted: 60000, lifetimeUsed: 11846, windowStartedAt: account.windowStartedAt },
      update: { balance: 15312, lifetimeGranted: 60000, lifetimeUsed: 11846, windowStartedAt: account.windowStartedAt },
    })
  })
})
