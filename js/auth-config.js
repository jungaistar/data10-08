// 로그인 설정 — 이 파일 한 곳만 바꾸면 된다(생성: data10-00/scripts/apply-auth-kit.mjs, 대문 문구 출처 docs/plan.json).
// 내 Supabase 로 옮길 때: url · anonKey 를 내 프로젝트 값으로, 카카오를 설정하지 않았으면 kakao: false. 안내 = docs/내_깃허브로_옮기기.md
// prefix 는 supabase/auth.sql 의 표 이름 앞부분과 같아야 한다.
window.AUTH_CONFIG = {
  "url": "https://hcmgdztsgjvzcyxyayaj.supabase.co",
  "anonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjbWdkenRzZ2p2emN5eHlheWFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MzU4ODcsImV4cCI6MjA4NzAxMTg4N30.gznaPzY1l8qDAPsEyYNR9KS7f7VqS3xaw-_2HTSwSZw",
  "prefix": "data1008",
  "kakao": true,
  "idleMinutes": 30,
  "localBypass": true,
  "site": {
    "title": "프레임 제작 생산성 개선",
    "summary": "일일 실적과 현장 측정으로 목표 대수 대비 달성률(90% 선)을 관리하고, 공정별 작업시간·손실·병목과 인원 배분, 개선 전후 단가 절감을 분석해 표준작업서 초안까지 만드는 브라우저 도구입니다.",
    "course": "현장 데이터 디지털화 전문가과정 · 2차수",
    "features": [
      {
        "name": "일일 실적 · 달성률",
        "desc": "날마다 목표·실제 대수·인원·가용시간을 넣거나 엑셀로 가져와 일·주·월 달성률과 90% 선을 봅니다."
      },
      {
        "name": "현장 측정 → 실적 자동 반영",
        "desc": "휴대폰 스톱워치로 공정별 작업 · 세팅 · 손실 · 휴식을 재고(잠깐 멈출 때는 일시정지), 「다음 대」로 끝낸 대수를 그날 실적에 자동으로 넣습니다."
      },
      {
        "name": "측정 항목 편집 · 비작업 시간",
        "desc": "측정 항목의 이름 · 분류 · 순서 · 숨기기를 현장에 맞게 바꾸고, 세팅 · 휴식 · 일시정지 같은 비작업 시간을 사이클타임과 따로 봅니다."
      },
      {
        "name": "공정 진행 · 지연 공정",
        "desc": "공정별 하루 CAPA 대비 완료 수와 사이클타임을 날짜별로 보고, 지연 공정을 빨갛게 표시합니다."
      }
    ],
    "steps": [
      "로그인 · 승인",
      "일일 실적 입력",
      "공정 · CAPA · 측정 항목",
      "현장 측정",
      "실적 자동 반영",
      "병목 · 손실 분석"
    ]
  }
};
