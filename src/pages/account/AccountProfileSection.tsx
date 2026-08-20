import { majorSuggestions } from '../../lib/profileFields'

interface AccountProfileSectionProps {
  name: string
  onNameChange: (value: string) => void
  qq: string
  onQqChange: (value: string) => void
  grade: string
  onGradeChange: (value: string) => void
  selectableGrades: string[]
  major: string
  onMajorChange: (value: string) => void
  disabled: boolean
}

export function AccountProfileSection({
  name,
  onNameChange,
  qq,
  onQqChange,
  grade,
  onGradeChange,
  selectableGrades,
  major,
  onMajorChange,
  disabled,
}: AccountProfileSectionProps) {
  return (
    <fieldset className="form-section" disabled={disabled}>
      <div className="section-title-row">
        <div>
          <h2>基本资料</h2>
          <p>姓名、年级和专业会显示在公开成员列表。</p>
        </div>
      </div>
      <div className="form-grid">
        <label>
          <span>姓名</span>
          <input required value={name} onChange={(event) => onNameChange(event.target.value)} />
        </label>
        <label>
          <span>QQ 号</span>
          <input
            required
            inputMode="numeric"
            pattern="[1-9][0-9]{4,11}"
            value={qq}
            onChange={(event) => onQqChange(event.target.value)}
          />
        </label>
        <label>
          <span>年级</span>
          <select required value={grade} onChange={(event) => onGradeChange(event.target.value)}>
            <option value="" disabled>
              请选择年级
            </option>
            {selectableGrades.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>专业</span>
          <input
            required
            list="major-suggestions"
            maxLength={100}
            placeholder="输入专业名称"
            value={major}
            onChange={(event) => onMajorChange(event.target.value)}
          />
          <datalist id="major-suggestions">
            {majorSuggestions.map((item) => (
              <option value={item} key={item} />
            ))}
          </datalist>
        </label>
      </div>
    </fieldset>
  )
}
