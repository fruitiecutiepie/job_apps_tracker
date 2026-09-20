import { afterEach, describe, expect, it, vi } from 'vitest'

async function linksWithBase(base: string) {
  vi.resetModules()
  vi.stubEnv('BASE_URL', base)
  return import('./siteLinks')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('links between the two hosted builds', () => {
  it('points at the demo one level below the tracker', async () => {
    const { demoSiteUrl } = await linksWithBase('/job_apps_tracker/')
    expect(demoSiteUrl()).toBe('/job_apps_tracker/demo/')
  })

  it('points back up from the demo to the tracker', async () => {
    const { trackerSiteUrl } = await linksWithBase('/job_apps_tracker/demo/')
    expect(trackerSiteUrl()).toBe('/job_apps_tracker/')
  })

  /* A fork is served from its own repository name, and a user page from the root. */
  it('follows whatever base the build was given', async () => {
    const forked = await linksWithBase('/someone-elses-fork/')
    expect(forked.demoSiteUrl()).toBe('/someone-elses-fork/demo/')

    const root = await linksWithBase('/')
    expect(root.demoSiteUrl()).toBe('/demo/')
    expect(root.trackerSiteUrl()).toBe('/')
  })

  it('survives a base with no trailing slash', async () => {
    const { demoSiteUrl } = await linksWithBase('/job_apps_tracker')
    expect(demoSiteUrl()).toBe('/job_apps_tracker/demo/')
  })
})
