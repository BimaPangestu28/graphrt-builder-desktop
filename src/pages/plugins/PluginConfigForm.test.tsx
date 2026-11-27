import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as pluginsApi from '@/api/plugins'
import { PluginConfigForm, toPluginConfigField, type PluginConfigField } from './PluginConfigForm'

const outputFolder: PluginConfigField = {
  variable: 'DOCUMENT_TEMPLATES_OUTPUT_DIR',
  label: 'Folder for finished documents',
  help: 'Invoices and other documents are saved here.',
  kind: 'folder',
  configured: false,
}

function renderForm(fields: PluginConfigField[], onSave = vi.fn(() => Promise.resolve())) {
  const onClear = vi.fn(() => Promise.resolve())
  const view = render(<PluginConfigForm pluginLabel="Document Templates" fields={fields} onSave={onSave} onClear={onClear} />)
  return { onSave, onClear, ...view }
}

describe('PluginConfigForm', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows the label and help of a setting instead of its variable name', () => {
    renderForm([outputFolder])
    const input = screen.getByLabelText('Folder for finished documents')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAccessibleDescription(/Invoices and other documents are saved here\. A folder that does not exist yet is created/)
    expect(screen.queryByText('DOCUMENT_TEMPLATES_OUTPUT_DIR')).not.toBeInTheDocument()
    // No secret in the form: nothing is "never shown again".
    expect(screen.queryByText(/never shown again/)).not.toBeInTheDocument()
  })

  it('saves the folder the picker returns right away', async () => {
    vi.spyOn(pluginsApi, 'pickPluginSettingPath').mockResolvedValue('/home/sari/Documents/Invoices')
    const { onSave } = renderForm([outputFolder])
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder for Folder for finished documents' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('DOCUMENT_TEMPLATES_OUTPUT_DIR', '/home/sari/Documents/Invoices'))
    expect(pluginsApi.pickPluginSettingPath).toHaveBeenCalledWith('folder', 'Folder for finished documents')
  })

  it('saves nothing when the picker is closed', async () => {
    const pick = vi.spyOn(pluginsApi, 'pickPluginSettingPath').mockResolvedValue(null)
    const { onSave } = renderForm([outputFolder])
    fireEvent.click(screen.getByRole('button', { name: /Choose folder for/ }))
    await waitFor(() => expect(pick).toHaveBeenCalled())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('adds a picked folder to a list of folders', async () => {
    vi.spyOn(pluginsApi, 'pickPluginSettingPath').mockResolvedValue('/home/sari/Logos')
    const inputs: PluginConfigField = { variable: 'DOCS_INPUT_DIRS', label: 'Folders to read from', kind: 'folder', multiple: true, value: '/home/sari/Templates', configured: true }
    const { onSave } = renderForm([inputs])
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder for Folders to read from' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('DOCS_INPUT_DIRS', '/home/sari/Templates, /home/sari/Logos'))
  })

  it('shows the saved value of a setting that is not a secret and saves only a change', () => {
    const saved: PluginConfigField = { ...outputFolder, value: '/home/sari/Documents/Invoices', configured: true }
    const { onSave } = renderForm([saved])
    const input = screen.getByLabelText('Folder for finished documents')
    expect(input).toHaveValue('/home/sari/Documents/Invoices')
    expect(screen.getByRole('button', { name: 'Save Folder for finished documents' })).toBeDisabled()

    fireEvent.change(input, { target: { value: '/home/sari/Documents/Faktur' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Folder for finished documents' }))
    expect(onSave).toHaveBeenCalledWith('DOCUMENT_TEMPLATES_OUTPUT_DIR', '/home/sari/Documents/Faktur')
  })

  it('shows the default of a number as a hint', () => {
    renderForm([{ variable: 'DOCS_MAX_PAGES', label: 'Most pages per document', kind: 'number', defaultValue: '200', configured: false }])
    expect(screen.getByLabelText('Most pages per document')).toHaveAttribute('placeholder', 'Default: 200')
  })

  it('keeps a secret hidden: a password input that is emptied after saving', async () => {
    const { onSave } = renderForm([{ variable: 'WHATSAPP_ACCESS_TOKEN', configured: true }])
    const input = screen.getByLabelText('WHATSAPP_ACCESS_TOKEN')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveValue('')
    expect(screen.getByText(/never shown again/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Choose/ })).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'EAAG-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save WHATSAPP_ACCESS_TOKEN' }))
    await waitFor(() => expect(input).toHaveValue(''))
    expect(onSave).toHaveBeenCalledWith('WHATSAPP_ACCESS_TOKEN', 'EAAG-secret')
  })

  it('says why a value could not be saved', async () => {
    const onSave = vi.fn(() => Promise.reject(new Error('`invoices` is not a full path')))
    renderForm([outputFolder], onSave)
    fireEvent.change(screen.getByLabelText('Folder for finished documents'), { target: { value: 'invoices' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Folder for finished documents' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save Folder for finished documents: `invoices` is not a full path')
  })

  it('reads a setting as the backend lists it, treating one without a kind as a secret', () => {
    expect(toPluginConfigField({ name: 'A_DIR', configured: true, optional: false, label: 'A folder', kind: 'folder', value: '/a' })).toEqual({
      variable: 'A_DIR',
      label: 'A folder',
      help: undefined,
      kind: 'folder',
      defaultValue: undefined,
      multiple: undefined,
      value: '/a',
      configured: true,
    })
    renderForm([toPluginConfigField({ name: 'OLD_TOKEN', configured: false, optional: false })])
    expect(screen.getByLabelText('OLD_TOKEN')).toHaveAttribute('type', 'password')
  })
})
