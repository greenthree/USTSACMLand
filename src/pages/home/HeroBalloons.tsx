import { memo, useEffect, useId, useRef } from 'react'
import {
  balloonStringPath,
  CEILING_MARGIN,
  FLOOR_Y,
  heroBalloons,
  KNOT_DROP,
  VIEW_H,
  VIEW_W,
  WALL_MARGIN,
} from './homeData'

// memo：组件无 props，仅首渲染一次；把 rAF 的命令式 DOM 写入与父级重渲染彻底隔离
export const HeroBalloons = memo(function HeroBalloons() {
  const gradientId = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  const bodyRefs = useRef<(SVGGElement | null)[]>([])
  const stringRefs = useRef<(SVGPathElement | null)[]>([])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return undefined

    const states = heroBalloons.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 }))
    const radii = heroBalloons.map((balloon) => (balloon.rx + balloon.ry) / 2)
    // 绳长约束边界（画框内、绳结不低于台面）提前算好，帧内不再重复
    const bounds = heroBalloons.map((balloon) => ({
      xMin: balloon.rx + WALL_MARGIN - balloon.cx,
      xMax: VIEW_W - WALL_MARGIN - balloon.rx - balloon.cx,
      yMin: balloon.ry + CEILING_MARGIN - balloon.cy,
      yMax: FLOOR_Y - (balloon.cy + balloon.ry),
    }))
    // 指针只存屏幕坐标，SVG 坐标每帧换算一次：避免高频事件里反复 getScreenCTM 强制布局，
    // 也让页面滚动后坐标保持正确（rect 每帧新取）。
    let pointerClient: { x: number; y: number } | null = null
    let frame = 0
    let running = false
    let last = performance.now()
    // 闲置（无有效指针且动能低）时隔帧执行，只剩慢速气流晃动，30fps 视觉无差
    let idle = false
    let parity = false

    const step = (now: number) => {
      if (!running) return
      parity = !parity
      if (idle && parity) {
        frame = requestAnimationFrame(step)
        return
      }
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const t = now / 1000
      let maxSpeed = 0

      // 每帧一次：屏幕坐标 → viewBox 坐标（xMidYMax meet 的手算逆映射）
      let pointer: { x: number; y: number } | null = null
      if (pointerClient) {
        const rect = svg.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          const scale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H)
          const px = (pointerClient.x - rect.left - (rect.width - VIEW_W * scale) / 2) / scale
          const py = (pointerClient.y - rect.top - (rect.height - VIEW_H * scale)) / scale
          // 指针已不在画框附近（如滚动把面板移走）则视为无指针，恢复闲置降频
          if (px > -40 && px < VIEW_W + 40 && py > -40 && py < VIEW_H + 40) {
            pointer = { x: px, y: py }
          }
        }
      }

      for (let i = 0; i < states.length; i += 1) {
        const state = states[i]
        const balloon = heroBalloons[i]
        // 回位弹簧 + 阻尼 + 气流（每只气球独立频率/相位的正弦风）
        let ax =
          Math.sin(t * balloon.airFreq + balloon.airPhase) * 78 - state.x * 16 - state.vx * 2.1
        let ay =
          Math.cos(t * balloon.airFreq * 0.8 + balloon.airPhase) * 34 -
          state.y * 20 -
          state.vy * 2.4

        if (pointer) {
          const bx = balloon.cx + state.x
          const by = balloon.cy + state.y
          const dx = bx - pointer.x
          const dy = by - pointer.y
          const dist = Math.hypot(dx, dy)
          const reach = Math.max(balloon.rx, balloon.ry) + 34
          if (dist < reach && dist > 0.01) {
            const push = ((reach - dist) / reach) * 560
            ax += (dx / dist) * push
            ay += (dy / dist) * push * 0.75
          }
        }

        state.vx += ax * dt
        state.vy += ay * dt
      }

      // 两两碰撞：软性排斥 + 位置分离，避免相互穿透
      for (let i = 0; i < states.length; i += 1) {
        for (let j = i + 1; j < states.length; j += 1) {
          const a = heroBalloons[i]
          const b = heroBalloons[j]
          const sa = states[i]
          const sb = states[j]
          const dx = b.cx + sb.x - (a.cx + sa.x)
          const dy = b.cy + sb.y - (a.cy + sa.y)
          const dist = Math.hypot(dx, dy) || 0.01
          const minDist = radii[i] + radii[j]
          if (dist < minDist) {
            const nx = dx / dist
            const ny = dy / dist
            const impulse = (minDist - dist) * 95 * dt
            sa.vx -= nx * impulse
            sa.vy -= ny * impulse
            sb.vx += nx * impulse
            sb.vy -= ny * impulse
            const separation = (minDist - dist) * 0.18
            sa.x -= nx * separation
            sa.y -= ny * separation
            sb.x += nx * separation
            sb.y += ny * separation
          }
        }
      }

      for (let i = 0; i < states.length; i += 1) {
        const state = states[i]
        const balloon = heroBalloons[i]
        const bound = bounds[i]
        state.x += state.vx * dt
        state.y += state.vy * dt

        if (state.x < bound.xMin) {
          state.x = bound.xMin
          state.vx = Math.max(state.vx, 0)
        } else if (state.x > bound.xMax) {
          state.x = bound.xMax
          state.vx = Math.min(state.vx, 0)
        }
        if (state.y < bound.yMin) {
          state.y = bound.yMin
          state.vy = Math.max(state.vy, 0)
        } else if (state.y > bound.yMax) {
          state.y = bound.yMax
          state.vy = Math.min(state.vy, 0)
        }
        maxSpeed = Math.max(maxSpeed, Math.abs(state.vx), Math.abs(state.vy))

        const tilt = Math.max(-7, Math.min(7, state.vx * 0.055 + state.x * 0.07))
        bodyRefs.current[i]?.setAttribute(
          'transform',
          `translate(${state.x.toFixed(2)} ${state.y.toFixed(2)}) rotate(${tilt.toFixed(2)} ${balloon.cx} ${balloon.cy + balloon.ry + KNOT_DROP})`,
        )
        stringRefs.current[i]?.setAttribute('d', balloonStringPath(balloon, state.x, state.y))
      }

      idle = pointer === null && maxSpeed < 14
      frame = requestAnimationFrame(step)
    }

    const start = () => {
      if (running) return
      running = true
      last = performance.now()
      frame = requestAnimationFrame(step)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(frame)
    }

    const resetBalloons = () => {
      for (let i = 0; i < states.length; i += 1) {
        states[i].x = 0
        states[i].y = 0
        states[i].vx = 0
        states[i].vy = 0
        bodyRefs.current[i]?.removeAttribute('transform')
        stringRefs.current[i]?.setAttribute('d', balloonStringPath(heroBalloons[i]))
      }
    }

    // 模拟只在「面板可见 且 未开启减弱动效」时运行；两个条件都可在运行期变化
    const reduceMotionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null
    let reduceMotion = reduceMotionQuery?.matches ?? false
    let visible = !('IntersectionObserver' in window)

    const syncRunning = () => {
      if (visible && !reduceMotion) start()
      else stop()
    }

    let visibility: IntersectionObserver | null = null
    if ('IntersectionObserver' in window) {
      visibility = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting
        // 面板离屏时把扫描线 CSS 动画一并暂停，与物理模拟同一节能口径
        svg.closest('.home-hero-art')?.classList.toggle('home-art-offscreen', !visible)
        syncRunning()
      })
      visibility.observe(svg)
    }
    const handleReduceMotionChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches
      if (reduceMotion) resetBalloons()
      syncRunning()
    }
    reduceMotionQuery?.addEventListener('change', handleReduceMotionChange)
    syncRunning()

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      pointerClient = { x: event.clientX, y: event.clientY }
    }
    const handlePointerLeave = () => {
      pointerClient = null
    }
    svg.addEventListener('pointermove', handlePointerMove, { passive: true })
    svg.addEventListener('pointerleave', handlePointerLeave, { passive: true })

    return () => {
      stop()
      visibility?.disconnect()
      reduceMotionQuery?.removeEventListener('change', handleReduceMotionChange)
      svg.removeEventListener('pointermove', handlePointerMove)
      svg.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [])

  return (
    <svg ref={svgRef} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMax meet">
      <defs>
        <radialGradient id={`${gradientId}-sheen`}>
          <stop offset="0" stopColor="#fff" stopOpacity="0.58" />
          <stop offset="0.4" stopColor="#fff" stopOpacity="0.3" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${gradientId}-string`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6f3e9" stopOpacity="0.58" />
          <stop offset="1" stopColor="#f6f3e9" stopOpacity="0.16" />
        </linearGradient>
      </defs>
      {heroBalloons.map((balloon, index) => {
        const { cx, cy, rx, ry } = balloon
        const bottom = cy + ry
        const knotY = bottom + KNOT_DROP
        const highlightX = cx - rx * 0.38
        const highlightY = cy - ry * 0.4
        // 保持原有包围盒和绳结锚点，上半部饱满、下半部自然收拢。
        const bodyPath = `M ${cx} ${bottom}
          C ${cx - rx * 0.14} ${bottom}, ${cx - rx * 0.14} ${cy + ry * 0.84}, ${cx - rx * 0.36} ${cy + ry * 0.72}
          C ${cx - rx * 0.76} ${cy + ry * 0.56}, ${cx - rx} ${cy + ry * 0.14}, ${cx - rx} ${cy - ry * 0.12}
          C ${cx - rx} ${cy - ry * 0.64}, ${cx - rx * 0.58} ${cy - ry}, ${cx} ${cy - ry}
          C ${cx + rx * 0.58} ${cy - ry}, ${cx + rx} ${cy - ry * 0.64}, ${cx + rx} ${cy - ry * 0.12}
          C ${cx + rx} ${cy + ry * 0.14}, ${cx + rx * 0.76} ${cy + ry * 0.56}, ${cx + rx * 0.36} ${cy + ry * 0.72}
          C ${cx + rx * 0.14} ${cy + ry * 0.84}, ${cx + rx * 0.14} ${bottom}, ${cx} ${bottom} Z`
        const bodyGradientId = `${gradientId}-body-${balloon.letter}`
        return (
          <g key={balloon.letter}>
            <path
              ref={(el) => {
                stringRefs.current[index] = el
              }}
              d={balloonStringPath(balloon)}
              stroke={`url(#${gradientId}-string)`}
              strokeWidth="1.1"
              strokeLinecap="round"
              fill="none"
            />
            <g
              className="home-balloon"
              ref={(el) => {
                bodyRefs.current[index] = el
              }}
            >
              <defs>
                <radialGradient id={bodyGradientId} cx="30%" cy="24%" r="78%">
                  <stop offset="0" stopColor={balloon.light} />
                  <stop offset="0.48" stopColor={balloon.fill} />
                  <stop offset="1" stopColor={balloon.shade} />
                </radialGradient>
              </defs>
              <path
                className="home-balloon-body"
                d={bodyPath}
                fill={`url(#${bodyGradientId})`}
                stroke={balloon.light}
                strokeOpacity="0.42"
                strokeWidth="0.7"
              />
              <path
                d={`M ${cx - 1.5} ${bottom - 1} Q ${cx} ${bottom + 1} ${cx + 1.5} ${bottom - 1}
                  L ${cx + 4} ${knotY - 0.7} Q ${cx} ${knotY + 1} ${cx - 4} ${knotY - 0.7} Z`}
                fill={balloon.knot}
              />
              <path
                d={`M ${cx - 1.6} ${bottom + 1.5} L ${cx + 1.6} ${bottom + 1.5}`}
                stroke={balloon.shade}
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <ellipse
                cx={highlightX}
                cy={highlightY}
                rx={rx * 0.4}
                ry={ry * 0.48}
                transform={`rotate(-24 ${highlightX} ${highlightY})`}
                fill={`url(#${gradientId}-sheen)`}
              />
              <path
                d={`M ${cx - rx * 0.72} ${cy - ry * 0.14}
                  C ${cx - rx * 0.74} ${cy - ry * 0.38}, ${cx - rx * 0.6} ${cy - ry * 0.62}, ${cx - rx * 0.38} ${cy - ry * 0.7}`}
                fill="none"
                stroke="#fff"
                strokeOpacity="0.32"
                strokeWidth={rx * 0.07}
                strokeLinecap="round"
              />
              <ellipse
                cx={cx + rx * 0.36}
                cy={cy + ry * 0.28}
                rx={rx * 0.16}
                ry={ry * 0.32}
                transform={`rotate(28 ${cx + rx * 0.36} ${cy + ry * 0.28})`}
                fill={`url(#${gradientId}-sheen)`}
                opacity="0.2"
              />
              <text
                x={cx}
                y={cy + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily="Consolas,monospace"
                fontSize={rx * 0.56}
                fontWeight="700"
                fill={balloon.ink}
              >
                {balloon.letter}
              </text>
            </g>
          </g>
        )
      })}
    </svg>
  )
})
