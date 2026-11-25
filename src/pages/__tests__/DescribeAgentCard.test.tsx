import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { readBuildRequest } from '@/pages/agent-builder/buildRequestState'
import { DescribeAgentCard, describeAgentPlaceholder, type DescribeAgentCardVariant } from '@/pages/home-dashboard/DescribeAgentCard'
import { routePaths } from '@/routes'

/** Stand-in for screen 03 that shows the build request it received. */
function GeneratingStandIn() {
  const location = useLocation()
  return <p>Generating screen {JSON.stringify(readBuildRequest(location.state))}</p>
}

function renderDescribeAgentCard(variant?: DescribeAgentCardVariant) {
  return render(
    <MemoryRouter initialEntries={[routePaths.home]}>
      <Routes>
        <Route path={routePaths.home} element={<DescribeAgentCard variant={variant} />} />
        <Route path={routePaths.generating} element={<GeneratingStandIn />} />
      </Routes>
    </MemoryRouter>,
  )
}

const jobDescription = 'Send me a summary of new Gmail invoices every Friday'

describe('DescribeAgentCard', () => {
  it('starts empty with the example as placeholder and "Build agent" disabled', () => {
    renderDescribeAgentCard()
    const prompt = screen.getByLabelText('What should your agent do?')
    expect(prompt).toHaveValue('')
    expect(prompt).toHaveAttribute('placeholder', describeAgentPlaceholder)
    expect(screen.getByRole('button', { name: 'Build agent' })).toBeDisabled()
  })

  it('keeps "Build agent" disabled for whitespace only', () => {
    renderDescribeAgentCard()
    fireEvent.change(screen.getByLabelText('What should your agent do?'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Build agent' })).toBeDisabled()
  })

  it('starts the build with the trimmed description from "Build agent"', () => {
    renderDescribeAgentCard()
    fireEvent.change(screen.getByLabelText('What should your agent do?'), { target: { value: `  ${jobDescription}  ` } })
    fireEvent.click(screen.getByRole('button', { name: 'Build agent' }))
    expect(screen.getByText(`Generating screen ${JSON.stringify({ description: jobDescription, kind: 'task' })}`)).toBeInTheDocument()
  })

  it('starts the build from ⌘+Enter and Ctrl+Enter', () => {
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      const { unmount } = renderDescribeAgentCard()
      const prompt = screen.getByLabelText('What should your agent do?')
      fireEvent.change(prompt, { target: { value: jobDescription } })
      fireEvent.keyDown(prompt, { key: 'Enter', ...modifier })
      expect(screen.getByText(/^Generating screen/)).toHaveTextContent(jobDescription)
      unmount()
    }
  })

  it('does nothing on plain Enter or on an empty shortcut', () => {
    renderDescribeAgentCard()
    const prompt = screen.getByLabelText('What should your agent do?')
    fireEvent.keyDown(prompt, { key: 'Enter', metaKey: true })
    fireEvent.change(prompt, { target: { value: jobDescription } })
    fireEvent.keyDown(prompt, { key: 'Enter' })
    expect(screen.queryByText(/^Generating screen/)).not.toBeInTheDocument()
  })

  it('builds from the hero the same way, with a bigger box and no template links', () => {
    renderDescribeAgentCard('hero')
    const prompt = screen.getByLabelText('What should your agent do?')
    expect(prompt).toHaveAttribute('rows', '4')
    expect(screen.queryByText('Start from a template:')).not.toBeInTheDocument()
    fireEvent.change(prompt, { target: { value: jobDescription } })
    fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true })
    expect(screen.getByText(`Generating screen ${JSON.stringify({ description: jobDescription, kind: 'task' })}`)).toBeInTheDocument()
  })

  it('keeps the template links under the compact box', () => {
    renderDescribeAgentCard()
    expect(screen.getByLabelText('What should your agent do?')).toHaveAttribute('rows', '3')
    expect(screen.getByText('Start from a template:')).toBeInTheDocument()
  })
})
