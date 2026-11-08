'use client'

import { createContext, useContext, useState } from 'react'

function useSelectionState() {
  const [semester, setSemester] = useState<number | null>(null)
  const [teacherId, setTeacherId] = useState<number | null>(null)
  const [student, setStudent] = useState<number | null>(null)
  const [studentLabel, setStudentLabel] = useState('')
  const [classId, setClassId] = useState<number | null>(null)
  const [selectedDimension, setDimension] = useState<'student' | 'class'>('student')
  return {
    semester,
    setSemester,
    teacherId,
    setTeacherId,
    student,
    setStudent,
    studentLabel,
    setStudentLabel,
    classId,
    setClassId,
    selectedDimension,
    setDimension,
  }
}
const Selection = createContext<ReturnType<typeof useSelectionState> | null>(null)
export function PortraitSelectionProvider({ children }: { children: React.ReactNode }) {
  const state = useSelectionState()
  return <Selection.Provider value={state}>{children}</Selection.Provider>
}
export function usePortraitSelection() {
  const state = useContext(Selection)
  if (!state) throw new Error('PortraitSelectionProvider is required')
  return state
}
