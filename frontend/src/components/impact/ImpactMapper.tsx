import { useEffect, useState, useRef } from 'react'
import './ImpactMapper.css'

export type ImpactNode = {
  id: string
  label: string
  type: 'modified' | 'impacted' | 'dependency'
  details: string
}

export type ImpactLink = {
  source: string
  target: string
}

export type ArchitectureImpactPayload = {
  severity: 'critical' | 'warning' | 'low'
  reason: string
  nodes: ImpactNode[]
  links: ImpactLink[]
}

type ImpactMapperProps = {
  hasChanges: boolean
  triggerReloadKey?: number
}

export function ImpactMapper({ hasChanges, triggerReloadKey }: ImpactMapperProps) {
  const [data, setData] = useState<ArchitectureImpactPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<ImpactNode | null>(null)
  
  const containerRef = useRef<HTMLDivElement>(null)
  const [, setDimensions] = useState({ width: 800, height: 400 })

  useEffect(() => {
    if (!hasChanges) {
      setData(null)
      return
    }

    let active = true
    setLoading(true)
    setError(null)
    setSelectedNode(null)

    fetch((import.meta.env.VITE_API_URL || 'http://localhost:3001') + '/ai/architecture-impact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load impact mapping (${res.status})`)
        }
        return res.json() as Promise<ArchitectureImpactPayload>
      })
      .then((payload) => {
        if (!active) return
        setData(payload)
        if (payload.nodes.length > 0) {
          setSelectedNode(payload.nodes[0])
        }
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Analysis failed')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [hasChanges, triggerReloadKey])

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight || 400,
        })
      }
    }
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [data])

  if (!hasChanges) {
    return (
      <div className="impact-empty">
        <div className="impact-empty-icon">🗺️</div>
        <h3>No Changes to Map</h3>
        <p>Modify or load a repository diff to view live structural impact flowcharts.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="impact-loading">
        <div className="impact-spinner" />
        <h3>Analyzing Repository Architecture...</h3>
        <p>Mapping dependencies, evaluating side-effects, and modeling structural ripple effects...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="impact-error">
        <div className="impact-error-icon">⚠️</div>
        <h3>Architectural Analysis Failed</h3>
        <p>{error}</p>
      </div>
    )
  }

  if (!data) return null

  // Categorize nodes for column layout
  const modifiedNodes = data.nodes.filter((n) => n.type === 'modified')
  const impactedNodes = data.nodes.filter((n) => n.type === 'impacted')
  const dependencyNodes = data.nodes.filter((n) => n.type === 'dependency')

  return (
    <div className="impact-mapper" ref={containerRef}>
      {/* Premium Header Severity Banner */}
      <div className={`impact-header-banner severity-${data.severity}`}>
        <div className="banner-badge">
          {data.severity.toUpperCase()} ARCHITECTURAL RISK
        </div>
        <div className="banner-details">
          <strong>Design Insight:</strong> {data.reason}
        </div>
      </div>

      <div className="impact-layout">
        {/* Columns visual nodes layout */}
        <div className="impact-columns">
          {/* Column 1: Modifications */}
          <div className="impact-column">
            <h4 className="column-title">MODIFIED FILES</h4>
            <div className="column-nodes">
              {modifiedNodes.map((node) => (
                <div
                  key={node.id}
                  className={`node-card type-modified ${selectedNode?.id === node.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedNode(node)}
                >
                  <div className="node-icon">✏️</div>
                  <div className="node-body">
                    <div className="node-label">{node.label}</div>
                    <div className="node-meta">Source file changed</div>
                  </div>
                </div>
              ))}
              {modifiedNodes.length === 0 && <div className="node-placeholder">None detected</div>}
            </div>
          </div>

          {/* SVG Arrow Connectors Center */}
          <div className="impact-connector-visual">
            <svg className="connector-svg" width="100%" height="100%">
              <defs>
                <linearGradient id="grad-modified-impacted" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ff4b4b" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#ffa500" stopOpacity="0.8" />
                </linearGradient>
                <linearGradient id="grad-impacted-dependency" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ffa500" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#00e676" stopOpacity="0.8" />
                </linearGradient>
              </defs>
              {/* Decorative moving dots / lines */}
              <line x1="10%" y1="30%" x2="90%" y2="30%" stroke="rgba(255,255,255,0.12)" strokeWidth="2" strokeDasharray="4 6" />
              <line x1="10%" y1="70%" x2="90%" y2="70%" stroke="rgba(255,255,255,0.12)" strokeWidth="2" strokeDasharray="4 6" />
            </svg>
            <div className="connector-arrow">➔</div>
          </div>

          {/* Column 2: Ripple Impacts */}
          <div className="impact-column">
            <h4 className="column-title">PREDICTED RIPPLE EFFECT</h4>
            <div className="column-nodes">
              {impactedNodes.map((node) => (
                <div
                  key={node.id}
                  className={`node-card type-impacted ${selectedNode?.id === node.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedNode(node)}
                >
                  <div className="node-icon">⚡</div>
                  <div className="node-body">
                    <div className="node-label">{node.label}</div>
                    <div className="node-meta">Direct downstream impact</div>
                  </div>
                </div>
              ))}
              {impactedNodes.length === 0 && (
                <div className="node-card type-low-risk">
                  <div className="node-icon">✅</div>
                  <div className="node-body">
                    <div className="node-label">Isolated Scope</div>
                    <div className="node-meta">Low side-effects risk</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Column 3: Dependencies */}
          <div className="impact-column">
            <h4 className="column-title">TRANSITIVE DEPENDENCIES</h4>
            <div className="column-nodes">
              {dependencyNodes.map((node) => (
                <div
                  key={node.id}
                  className={`node-card type-dependency ${selectedNode?.id === node.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedNode(node)}
                >
                  <div className="node-icon">📦</div>
                  <div className="node-body">
                    <div className="node-label">{node.label}</div>
                    <div className="node-meta">Shared system components</div>
                  </div>
                </div>
              ))}
              {dependencyNodes.length === 0 && <div className="node-placeholder">No deep linkages</div>}
            </div>
          </div>
        </div>

        {/* Selected Node Details Display Panel */}
        {selectedNode && (
          <div className="impact-detail-panel">
            <div className="panel-hdr">
              <span className={`panel-badge badge-${selectedNode.type}`}>{selectedNode.type.toUpperCase()}</span>
              <h3>{selectedNode.id}</h3>
            </div>
            <p className="panel-desc">{selectedNode.details}</p>
          </div>
        )}
      </div>
    </div>
  )
}
