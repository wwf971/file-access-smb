import { useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import { SmbMarkdownTextEditor } from '@wwf971/file-access-smb'
import { fapSmbExternalStore } from '../store/fapSmbExternalStore'

const FapSmbExternalEditorTxt = observer(() => {
  const isOpen = fapSmbExternalStore.isTextEditorOpen
  const isBusy = fapSmbExternalStore.isTextEditorLoading || fapSmbExternalStore.isTextEditorSaving

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        fapSmbExternalStore.requestSaveTextEditor()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  return (
    <div className="txt-editor-overlay">
      <div className="txt-editor-popup">
        <SmbMarkdownTextEditor
          data={{
            titleText: fapSmbExternalStore.textEditorPath,
            subtitleText: [
              fapSmbExternalStore.isTextEditorDirty ? 'modified' : 'saved',
              fapSmbExternalStore.textEditorBackupPath ? `backup: ${fapSmbExternalStore.textEditorBackupPath}` : '',
            ].filter(Boolean).join(' | '),
            contentText: fapSmbExternalStore.textEditorContent,
            messageState: {
              status: fapSmbExternalStore.textEditorErrorText ? 'error' : 'info',
              messageText: [
                fapSmbExternalStore.textEditorErrorText || fapSmbExternalStore.textEditorStatusText,
                fapSmbExternalStore.isTextEditorDecodeLossy ? 'some bytes could not be decoded as utf-8' : '',
              ].filter(Boolean).join(' | '),
            },
          }}
          config={{
            isBusy,
            isMarkdown: fapSmbExternalStore.isTextEditorMarkdown,
            isPreviewVisible: fapSmbExternalStore.isMarkdownPreviewVisible,
            isSaveVisible: true,
            isCloseVisible: true,
          }}
          onEvent={(eventType, eventData) => {
            if (eventType === 'previewToggleRequest') {
              fapSmbExternalStore.toggleMarkdownPreview()
            }
            if (eventType === 'saveRequest') {
              fapSmbExternalStore.requestSaveTextEditor()
            }
            if (eventType === 'closeRequest') {
              fapSmbExternalStore.closeTextEditor()
            }
            if (eventType === 'dismissMessageRequest') {
              fapSmbExternalStore.dismissTextEditorMessage()
            }
            if (eventType === 'contentChange') {
              fapSmbExternalStore.setTextEditorContent(`${eventData?.contentText ?? ''}`)
            }
          }}
        />
      </div>
    </div>
  )
})

export default FapSmbExternalEditorTxt
