import { RefreshIcon } from '@wwf971/react-comp-misc'
import { useEffect, useRef } from 'react'
import type { FapSmbExternalItem } from '../store/fapSmbExternalStore'

type FapSmbExternalSelectorProps = {
  items: FapSmbExternalItem[]
  selectedItem: FapSmbExternalItem | null
  searchText: string
  onSearchTextChange: (searchText: string) => void
  onSelect: (fileAccessPointId: string) => void
  onRefresh: () => void
}

const FapSmbExternalSelector = ({
  items,
  selectedItem,
  searchText,
  onSearchTextChange,
  onSelect,
  onRefresh,
}: FapSmbExternalSelectorProps) => {
  const searchRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (searchRef.current && searchRef.current.textContent !== searchText) {
      searchRef.current.textContent = searchText
    }
  }, [searchText])

  return (
    <div className="fap-smb-external-selector-root">
      <div className="fap-smb-external-selector-search-row">
        <div className="fap-smb-external-selector-tags">
          {selectedItem ? (
            <button
              type="button"
              className="fap-smb-external-selector-tag"
              title={selectedItem.fileAccessPointId}
              onClick={() => {
                onSearchTextChange('')
              }}
            >
              <span>{selectedItem.name}</span>
              <span className="fap-smb-external-selector-tag-id">{selectedItem.fileAccessPointId}</span>
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="task-copy-move-icon-btn"
          title="fetch file access points"
          onClick={onRefresh}
        >
          <RefreshIcon width={13} height={13} />
        </button>
      </div>
      <div
        ref={searchRef}
        className="fap-smb-external-selector-search"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        spellCheck={false}
        onInput={(event) => {
          onSearchTextChange((event.currentTarget.textContent || '').trim())
        }}
      />
      <div className="fap-smb-external-selector-list">
        {items.map((item) => (
          <button
            key={item.fileAccessPointId}
            type="button"
            className={`fap-smb-external-selector-item ${item.fileAccessPointId === selectedItem?.fileAccessPointId ? 'is-selected' : ''}`}
            onClick={() => {
              onSelect(item.fileAccessPointId)
            }}
          >
            <span>{highlightMatch(item.name, searchText)}</span>
            <span className="fap-smb-external-selector-item-id">
              {highlightMatch(item.fileAccessPointId, searchText)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function highlightMatch(text: string, searchText: string) {
  const value = String(text || '')
  const query = String(searchText || '').trim()
  if (!query) {
    return value
  }
  const index = value.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) {
    return value
  }
  return (
    <>
      {value.slice(0, index)}
      <span className="fap-smb-external-selector-match">{value.slice(index, index + query.length)}</span>
      {value.slice(index + query.length)}
    </>
  )
}

export default FapSmbExternalSelector
