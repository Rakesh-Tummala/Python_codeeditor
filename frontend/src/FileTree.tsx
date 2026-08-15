import { useState } from 'react'
import type { TreeNode } from './api'

interface TreeActions {
  activePath: string | null
  onOpenFile: (path: string) => void
  onCreate: (parentDir: string, isDir: boolean) => void
  onDelete: (path: string) => void
  onRename: (oldPath: string) => void
}

interface FileTreeProps extends TreeActions {
  tree: TreeNode[]
}

interface TreeLevelProps extends TreeActions {
  nodes: TreeNode[]
}

interface TreeEntryProps extends TreeActions {
  node: TreeNode
}

export default function FileTree({ tree, activePath, onOpenFile, onCreate, onDelete, onRename }: FileTreeProps) {
  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span>Files</span>
        <div className="file-tree-actions">
          <button title="New file" onClick={() => onCreate('', false)}>
            +file
          </button>
          <button title="New folder" onClick={() => onCreate('', true)}>
            +dir
          </button>
        </div>
      </div>
      <TreeLevel
        nodes={tree}
        activePath={activePath}
        onOpenFile={onOpenFile}
        onCreate={onCreate}
        onDelete={onDelete}
        onRename={onRename}
      />
    </div>
  )
}

function TreeLevel({ nodes, activePath, onOpenFile, onCreate, onDelete, onRename }: TreeLevelProps) {
  return (
    <ul className="file-tree-level">
      {nodes.map((node) => (
        <TreeEntry
          key={node.path}
          node={node}
          activePath={activePath}
          onOpenFile={onOpenFile}
          onCreate={onCreate}
          onDelete={onDelete}
          onRename={onRename}
        />
      ))}
    </ul>
  )
}

function TreeEntry({
  node,
  activePath,
  onOpenFile,
  onCreate,
  onDelete,
  onRename,
}: TreeEntryProps) {
  const [expanded, setExpanded] = useState(true)

  if (node.type === 'file') {
    return (
      <li>
        <div
          className={`file-tree-row${node.path === activePath ? ' active' : ''}`}
          onClick={() => onOpenFile(node.path)}
        >
          <span className="file-tree-name">{node.name}</span>
          <span className="file-tree-row-actions">
            <button title="Rename" onClick={(e) => { e.stopPropagation(); onRename(node.path) }}>
              rn
            </button>
            <button title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(node.path) }}>
              x
            </button>
          </span>
        </div>
      </li>
    )
  }

  return (
    <li>
      <div className="file-tree-row" onClick={() => setExpanded((v) => !v)}>
        <span className="file-tree-name">{expanded ? '▾' : '▸'} {node.name}/</span>
        <span className="file-tree-row-actions">
          <button title="New file here" onClick={(e) => { e.stopPropagation(); onCreate(node.path, false) }}>
            +f
          </button>
          <button title="New folder here" onClick={(e) => { e.stopPropagation(); onCreate(node.path, true) }}>
            +d
          </button>
          <button title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(node.path) }}>
            x
          </button>
        </span>
      </div>
      {expanded && node.children && (
        <div className="file-tree-children">
          <TreeLevel
            nodes={node.children}
            activePath={activePath}
            onOpenFile={onOpenFile}
            onCreate={onCreate}
            onDelete={onDelete}
            onRename={onRename}
          />
        </div>
      )}
    </li>
  )
}
