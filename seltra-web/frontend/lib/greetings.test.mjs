import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getGreeting } from './greetings.ts'

describe('getGreeting', () => {
  const greeting = (hour, hasProjects = false, firstName = 'William') =>
    getGreeting({ firstName, hasProjects, hour, seed: 'user-123:2026-10-30' })

  it('uses the morning greeting for a new user', () => {
    assert.equal(greeting(8), "Good morning, William. Let's build something.")
  })

  it('uses the afternoon greeting for a new user', () => {
    assert.equal(greeting(13), 'Good afternoon, William. Ready to build?')
  })

  it('uses the evening greeting for a new user', () => {
    assert.equal(greeting(18), "Good evening, William. Let's start your store.")
  })

  it('uses the night greeting for a new user', () => {
    assert.equal(greeting(2), "Hello, night owl. Let's build your first store.")
  })

  it('uses time-specific greetings for returning users', () => {
    assert.equal(greeting(8, true), 'Good morning, William.')
    assert.equal(greeting(13, true), 'Good afternoon, William.')
    assert.equal(greeting(18, true), 'Good evening, William.')
    assert.equal(greeting(2, true), 'Hello, night owl.')
  })

  it('omits a missing name cleanly', () => {
    assert.equal(greeting(8, false, ''), "Good morning. Let's build something.")
    assert.equal(greeting(13, true, null), 'Good afternoon.')
  })

  it('uses generic greetings when the local hour is unavailable', () => {
    assert.equal(greeting(null), "Welcome, William. What's the vision?")
  })

  it('maps all time bucket boundaries correctly', () => {
    assert.equal(greeting(4), "Hello, night owl. Let's build your first store.")
    assert.equal(greeting(5), "Good morning, William. Let's build something.")
    assert.equal(greeting(11), "Good morning, William. Let's build something.")
    assert.equal(greeting(12), 'Good afternoon, William. Ready to build?')
    assert.equal(greeting(16), 'Good afternoon, William. Ready to build?')
    assert.equal(greeting(17), "Good evening, William. Let's start your store.")
    assert.equal(greeting(20), "Good evening, William. Let's start your store.")
    assert.equal(greeting(21), "Hello, night owl. Let's build your first store.")
  })

  it('selects a stable returning-user generic variant for the same seed', () => {
    const first = greeting(null, true)
    const second = greeting(null, true)
    assert.equal(first, second)
    assert.ok([
      'Ready when you are, William.',
      'Welcome back, William.',
      'Pick up where you left off.',
      'What are we building today, William?',
    ].includes(first))
  })
})
