import Pause from 'lucide-react/dist/esm/icons/pause'
import Play from 'lucide-react/dist/esm/icons/play'
import { useEffect, useState, type CSSProperties } from 'react'
import {
  cloneSchoolRollboardTeams,
  completedSchoolRollboardTeams,
  describeRollboardSubmission,
  formatRollboardSubmission,
  rankSchoolRollboardTeams,
  revealSchoolRollboardProblem,
  schoolRollboardTeams,
} from './freshmanContestData'

export function SchoolRollboard() {
  const reduceMotion =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const [teams, setTeams] = useState(() =>
    reduceMotion ? completedSchoolRollboardTeams() : cloneSchoolRollboardTeams(),
  )
  const [paused, setPaused] = useState(false)
  const [risingReveal, setRisingReveal] = useState<{
    teamId: string
    problemLabel: string
  }>()
  const toggleLabel = paused ? '继续滚榜动画' : '暂停滚榜动画'
  const rankedTeams = rankSchoolRollboardTeams(teams)
  const currentTeam = [...rankedTeams]
    .reverse()
    .find((team) => team.problems.some((problem) => problem.state === 'pending'))
  const currentProblem = currentTeam?.problems.find((problem) => problem.state === 'pending')
  const currentTeamId = currentTeam?.id
  const currentProblemLabel = currentProblem?.label
  const risingTeamId = risingReveal?.teamId
  const risingTeam = risingTeamId ? teams.find((team) => team.id === risingTeamId) : undefined
  const highlightedTeamId = risingTeamId ?? currentTeamId

  useEffect(() => {
    if (paused || reduceMotion || risingReveal) return undefined

    const timer = window.setTimeout(
      () => {
        if (!currentTeamId || !currentProblemLabel) {
          setRisingReveal(undefined)
          setTeams(cloneSchoolRollboardTeams())
          return
        }

        if (currentProblem?.reveal === 'ac') {
          setRisingReveal({ teamId: currentTeamId, problemLabel: currentProblemLabel })
        }

        setTeams((current) =>
          current.map((team) =>
            team.id === currentTeamId
              ? revealSchoolRollboardProblem(team, currentProblemLabel)
              : team,
          ),
        )
      },
      currentTeamId ? 1350 : 2600,
    )

    return () => window.clearTimeout(timer)
  }, [
    currentProblem?.reveal,
    currentProblemLabel,
    currentTeamId,
    paused,
    reduceMotion,
    risingReveal,
  ])

  useEffect(() => {
    if (!risingReveal) return undefined

    const timer = window.setTimeout(() => setRisingReveal(undefined), 1100)
    return () => window.clearTimeout(timer)
  }, [risingReveal])

  return (
    <section className={`school-rollboard${paused ? ' is-paused' : ''}`} aria-label="滚榜动画演示">
      <header className="school-rollboard-intro">
        <div>
          <p>ROLLING / SIMULATION 01</p>
          <h3>从最后一支待揭晓队伍开始</h3>
          <span>
            队伍按名次由下向上，题目按 A–L
            从左到右揭晓；题格显示提交次数/提交时间（分钟），绿色记录首次
            AC，红色与蓝色记录最后一次提交。
          </span>
        </div>
        <button type="button" onClick={() => setPaused((current) => !current)} title={toggleLabel}>
          {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          <span>{paused ? '继续' : '暂停'}</span>
          <span className="sr-only">滚榜动画</span>
        </button>
      </header>

      <div
        className="school-rollboard-frame"
        role="img"
        aria-label="模拟真实滚榜：从最低名次的待揭晓队伍开始，题格显示提交次数和提交时间，并在揭晓通过后重新排名"
      >
        <div className="school-rollboard-columns" aria-hidden="true">
          <span>名次</span>
          <span>队伍</span>
          {schoolRollboardTeams[0].problems.map((problem) => (
            <span key={problem.label} className="school-rollboard-problem-head">
              {problem.label}
            </span>
          ))}
          <span>AC</span>
          <span className="school-rollboard-penalty">罚时</span>
        </div>
        <ol aria-hidden="true">
          {teams.map((team) => {
            const rank = rankedTeams.findIndex((rankedTeam) => rankedTeam.id === team.id)
            const rowStyle = { '--rollboard-rank': rank } as CSSProperties

            return (
              <li
                key={team.id}
                className={`school-rollboard-row${team.id === highlightedTeamId ? ' is-current' : ''}${team.id === risingTeamId ? ' is-rising' : ''}`}
                data-rollboard-team={team.id}
                style={rowStyle}
              >
                <span className="school-rollboard-rank">{String(rank + 1).padStart(2, '0')}</span>
                <strong>{team.team}</strong>
                {team.problems.map((problem) => {
                  const active =
                    !risingReveal &&
                    team.id === currentTeamId &&
                    problem.label === currentProblemLabel

                  return (
                    <span
                      key={problem.label}
                      className={`school-rollboard-problem is-${problem.state}${active ? ' is-active' : ''}`}
                      data-rollboard-problem={problem.label}
                      title={describeRollboardSubmission(problem)}
                    >
                      {formatRollboardSubmission(problem)}
                    </span>
                  )
                })}
                <span className="school-rollboard-solved">
                  {String(team.solved).padStart(2, '0')}
                </span>
                <span className="school-rollboard-penalty">{team.penalty}</span>
              </li>
            )
          })}
        </ol>
        <footer aria-hidden="true">
          <span className="school-rollboard-live-dot" />
          从最低未揭晓队伍开始，逐题确认封榜提交
          <span>
            {risingReveal && risingTeam
              ? `RISING / ${risingTeam.team} / ${risingReveal.problemLabel}`
              : currentTeam && currentProblem
                ? `CURRENT / ${currentTeam.team} / ${currentProblem.label}`
                : 'FINAL / COMPLETE'}
          </span>
        </footer>
      </div>
    </section>
  )
}
