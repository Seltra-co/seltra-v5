import { sendSignupNotificationFireAndForget } from '../resend/resend.service'

describe('signup notification', () => {
  it('signup succeeds when the mailer throws', async () => {
    const mailer = jest.fn().mockRejectedValue(new Error('mailer unavailable'))

    await expect(sendSignupNotificationFireAndForget(mailer, jest.fn())).resolves.toBeUndefined()
  })
})
