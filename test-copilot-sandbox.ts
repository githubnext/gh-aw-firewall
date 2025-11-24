import { SandboxManager, type SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

async function main() {
  // Load the sandbox configuration from .srt-settings.json
  const configPath = join(process.cwd(), '.srt-settings.json')
  const configData = readFileSync(configPath, 'utf-8')
  const config: SandboxRuntimeConfig = JSON.parse(configData)

  console.log('Initializing sandbox with config:', JSON.stringify(config, null, 2))

  // Initialize the sandbox (starts proxy servers, etc.)
  await SandboxManager.initialize(config)

  console.log('Sandbox initialized successfully')

  // The command to run
  const command = 'npx -y @github/copilot@0.0.347 -p "whats 2+2"'

  // Wrap the command with sandbox restrictions
  const sandboxedCommand = await SandboxManager.wrapWithSandbox(command)

  console.log(`Executing sandboxed command: ${sandboxedCommand}`)

  // Execute the sandboxed command
  const child = spawn(sandboxedCommand, {
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
      NO_COLOR: '1',
      TERM: 'dumb'
    }
  })

  // Handle exit
  child.on('exit', async (code) => {
    console.log(`\nCommand exited with code ${code}`)

    // Cleanup when done
    await SandboxManager.reset()
    console.log('Sandbox cleaned up')

    process.exit(code || 0)
  })

  // Handle errors
  child.on('error', async (err) => {
    console.error('Error executing command:', err)
    await SandboxManager.reset()
    process.exit(1)
  })
}

// Run the main function
main().catch(async (err) => {
  console.error('Fatal error:', err)
  await SandboxManager.reset()
  process.exit(1)
})
