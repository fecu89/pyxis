"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Info, LoaderCircle, ListChecks, Link2, Palette, ShieldCheck, Snowflake, UserPlus, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { PadAccessRequests } from "@/components/pad/pad-access-requests";
import { PadInviteLinks } from "@/components/pad/pad-invite-links";
import { PadSharingSettings } from "@/components/pad/settings/pad-sharing-settings";
import { PadAppearanceForm } from "@/components/pad/settings/pad-appearance-form";
import { BoardBackgroundImageField } from "@/components/pad/settings/board-background-image-field";
import { PostFieldDesigner } from "@/components/pad/settings/post-field-designer";
import { AttachmentPolicyForm } from "@/components/pad/settings/attachment-policy-form";
import { MemberInvitePicker } from "@/components/pad/settings/member-invite-picker";
import { MemberGroupInvite } from "@/components/pad/settings/member-group-invite";
import { OptionPicker } from "@/components/pad/settings/option-picker";
import settingsStyles from "@/components/pad/settings/settings.module.css";
import type { AttachmentDownloadPolicy } from "@/components/pad/attachments/types";
import type { PadData, PadRole } from "@/components/pad/types";
import type { PadPresentationSettings, PostFieldConfig } from "@/components/pad/settings/types";
import { requestJson } from "@/lib/api-client";
import tabStyles from "@/components/pad/settings/pad-settings-tabs.module.css";

type MemberDTO = { role: Exclude<PadRole, null>; user: { id: string; name: string | null; loginIdentifier: string | null; image: string | null } };

export type ParticipationSettings = {
  allowMemberPosting: boolean;
  allowMemberFileUpload: boolean;
  allowComments: boolean;
  allowReactions: boolean;
};

// "공개·공유"는 URL을 전달하는 상단 공유창과 분리하고, 누가 패드를 찾고 들어올 수 있는지만
// 관리합니다. 초대 링크는 이 탭에 두고, 접근 요청 승인은 멤버 관리에 모읍니다.
const TABS = [
  { key: "basic", label: "기본 정보", icon: <Info size={16} />, description: "패드 이름, 소개, 배경" },
  { key: "share", label: "공개·공유", icon: <Link2 size={16} />, description: "범위, 비밀번호, 초대 링크" },
  { key: "appearance", label: "외형", icon: <Palette size={16} />, description: "레이아웃, 색상, 글꼴" },
  { key: "fields", label: "게시물 필드", icon: <ListChecks size={16} />, description: "질문과 작성 항목" },
  { key: "participation", label: "참여·첨부", icon: <Users size={16} />, description: "권한, 반응, 다운로드" },
  { key: "moderation", label: "승인·동결", icon: <ShieldCheck size={16} />, description: "게시 승인, 패드 동결" },
  { key: "members", label: "멤버", icon: <UserPlus size={16} />, description: "접근 요청, 역할 관리, 멤버 추가" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// 예전에는 이 내용 전부가 설정 모달 하나에 순서 없이 나열돼 있어서(padupgrade.md 완료 이후
// 기능이 계속 추가되며 누적), "어디서 뭘 찾아야 할지 모르겠다"는 피드백을 받았습니다. Padlet처럼
// 기능별로 묶은 탭으로 나눴습니다.
//
// 모든 필드가 controlled(부모의 draft state + onChange)입니다 — "설정 저장" 버튼을 눌러야만
// 반영되는 게 불편하다는 피드백을 받아, 부모(pad-canvas.tsx)가 값이 바뀔 때마다 바로 저장하도록
// 바꿨습니다. 이 컴포넌트는 그 draft 값을 그대로 보여주고 바뀐 값을 올려보내기만 합니다.
//
// 공개 범위·비밀번호는 되돌리기 어려운 값이라 PadSharingSettings의 명시적인 저장 버튼을 쓰고,
// 나머지 controlled 설정은 부모(pad-canvas.tsx)의 자동 저장 흐름을 그대로 사용합니다.
export function PadSettingsTabs({
  board,
  isOwner,
  frozen,
  titleDraft,
  onTitleChange,
  descriptionDraft,
  onDescriptionChange,
  appearanceDraft,
  onAppearanceChange,
  onBackgroundImageChange,
  fieldConfigDraft,
  onFieldConfigChange,
  onApplyFieldConfig,
  participationDraft,
  onParticipationChange,
  reactionPolicyDraft,
  onReactionPolicyChange,
  downloadPolicyDraft,
  onDownloadPolicyChange,
  moderationModeDraft,
  onModerationModeChange,
  freezeAtDraft,
  onFreezeAtChange,
  onToggleFreeze,
  onInviteMember,
  onChangeMemberRole,
  onRemoveMember,
}: {
  board: PadData;
  isOwner: boolean;
  frozen: boolean;
  titleDraft: string;
  onTitleChange: (value: string) => void;
  descriptionDraft: string;
  onDescriptionChange: (value: string) => void;
  appearanceDraft: PadPresentationSettings;
  onAppearanceChange: (value: PadPresentationSettings) => void;
  onBackgroundImageChange: (value: string | null) => void;
  fieldConfigDraft: PostFieldConfig;
  onFieldConfigChange: (value: PostFieldConfig) => void;
  onApplyFieldConfig: () => void;
  participationDraft: ParticipationSettings;
  onParticipationChange: (value: ParticipationSettings) => void;
  reactionPolicyDraft: "SINGLE" | "MULTIPLE";
  onReactionPolicyChange: (value: "SINGLE" | "MULTIPLE") => void;
  downloadPolicyDraft: AttachmentDownloadPolicy;
  onDownloadPolicyChange: (value: AttachmentDownloadPolicy) => void;
  moderationModeDraft: PadData["moderationMode"];
  onModerationModeChange: (value: PadData["moderationMode"]) => void;
  freezeAtDraft: string;
  onFreezeAtChange: (value: string) => void;
  onToggleFreeze: () => void;
  onInviteMember: () => Promise<void>;
  onChangeMemberRole: (userId: string, role: string) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("basic");
  // 초기 페이지 로드의 board.members는 미리보기(최대 200명)만 담고 있어서, 실제 관리(역할
  // 변경·제거)는 멤버 탭을 열 때 전체 목록을 따로 불러옵니다. 그 전까지는 미리보기를 그대로
  // 보여줘서(대부분의 보드는 200명을 안 넘기므로) 빈 화면이 먼저 번쩍이지 않게 합니다.
  const [fullMembers, setFullMembers] = useState<MemberDTO[] | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [memberPage, setMemberPage] = useState(0);
  const [memberTotalCount, setMemberTotalCount] = useState(board.memberCount);
  const [showEmailInvite, setShowEmailInvite] = useState(false);
  const [showGroupInvite, setShowGroupInvite] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const memberLoadInFlight = useRef(false);
  const memberRefreshPending = useRef(false);

  async function loadMembers(page = 1, append = false) {
    if (memberLoadInFlight.current) {
      // 조회 중 접근 요청을 승인해도 갱신을 버리지 않습니다. 더 보기는 중복 요청만 막고,
      // 목록 변경 뒤의 새로고침은 진행 중인 조회가 끝난 뒤 한 번 실행합니다.
      if (!append) memberRefreshPending.current = true;
      return;
    }
    memberLoadInFlight.current = true;
    setLoadingMembers(true);
    try {
      const result = await requestJson<{ members: MemberDTO[]; page: number; totalCount: number }>(`/api/boards/${board.id}/members?page=${page}`);
      setFullMembers((current) => append && current ? [...current, ...result.members.filter((member) => !current.some((item) => item.user.id === member.user.id))] : result.members);
      setMemberPage(result.page);
      setMemberTotalCount(result.totalCount);
    } catch {
      // 기존 미리보기 목록을 유지하고, 다음 탭 진입이나 변경 작업 때 다시 시도합니다.
    } finally {
      memberLoadInFlight.current = false;
      setLoadingMembers(false);
      if (memberRefreshPending.current) {
        memberRefreshPending.current = false;
        void loadMembers();
      }
    }
  }

  function selectTab(tab: TabKey) {
    setActiveTab(tab);
    contentRef.current?.scrollTo({ top: 0 });
    if (tab === "members" && !fullMembers) void loadMembers();
  }

  function moveTabFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const key = event.key;
    let nextIndex = index;
    if (key === "ArrowRight" || key === "ArrowDown") nextIndex = (index + 1) % TABS.length;
    else if (key === "ArrowLeft" || key === "ArrowUp") nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (key === "Home") nextIndex = 0;
    else if (key === "End") nextIndex = TABS.length - 1;
    else return;

    event.preventDefault();
    const nextTab = TABS[nextIndex];
    selectTab(nextTab.key);
    requestAnimationFrame(() => document.getElementById(`settings-tab-${nextTab.key}`)?.focus());
  }

  function patchParticipation(patch: Partial<ParticipationSettings>) {
    onParticipationChange({ ...participationDraft, ...patch });
  }

  const members = fullMembers ?? board.members;
  const activeTabInfo = TABS.find((tab) => tab.key === activeTab) ?? TABS[0];

  return (
    <div className={tabStyles.wrap}>
      <div className={tabStyles.tabList} role="tablist" aria-label="패드 설정 분류">
        {TABS.map((tab, index) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`settings-tab-${tab.key}`}
            aria-controls={`settings-panel-${tab.key}`}
            title={tab.description}
            aria-selected={activeTab === tab.key}
            tabIndex={activeTab === tab.key ? 0 : -1}
            className={`${tabStyles.tab} ${activeTab === tab.key ? tabStyles.tabActive : ""}`}
            onClick={() => selectTab(tab.key)}
            onKeyDown={(event) => moveTabFocus(event, index)}
          >
            <span className={tabStyles.tabIcon}>{tab.icon}</span>
            <span className={tabStyles.tabCopy}><b>{tab.label}</b><small>{tab.description}</small></span>
          </button>
        ))}
      </div>

      <div className={tabStyles.content} ref={contentRef}>
        <header className={tabStyles.contentHeader}>
          <span>{activeTabInfo.icon}</span>
          <div><h3>{activeTabInfo.label}</h3><p>{activeTabInfo.description}</p></div>
        </header>

      <div id="settings-panel-basic" role="tabpanel" aria-labelledby="settings-tab-basic" className={tabStyles.tabPanel} hidden={activeTab !== "basic"}>
        <fieldset className={settingsStyles.group}>
          <legend>이름과 소개</legend>
          <label className={settingsStyles.field}><span>패드 이름</span><input value={titleDraft} onChange={(event) => onTitleChange(event.target.value)} required maxLength={120} autoFocus /></label>
          <label className={settingsStyles.field}><span>소개</span><textarea value={descriptionDraft} onChange={(event) => onDescriptionChange(event.target.value)} rows={3} maxLength={500} /></label>
        </fieldset>
        <BoardBackgroundImageField boardId={board.id} value={appearanceDraft.backgroundImageUrl ?? null} onChange={onBackgroundImageChange} />
      </div>

      <div id="settings-panel-share" role="tabpanel" aria-labelledby="settings-tab-share" className={tabStyles.tabPanel} hidden={activeTab !== "share"}>
        <PadSharingSettings board={board} isOwner={isOwner} />
        <PadInviteLinks boardId={board.id} />
      </div>

      <div id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" className={tabStyles.tabPanel} hidden={activeTab !== "appearance"}>
        <PadAppearanceForm value={appearanceDraft} onChange={onAppearanceChange} />
      </div>

      <div id="settings-panel-fields" role="tabpanel" aria-labelledby="settings-tab-fields" className={tabStyles.tabPanel} hidden={activeTab !== "fields"}>
        <PostFieldDesigner value={fieldConfigDraft} onChange={onFieldConfigChange} />
        <p className={settingsStyles.note}>이 탭은 다른 탭과 달리 바로 저장되지 않습니다. 라벨·선택지를 다 다듬은 뒤 버튼을 눌러 적용하세요.</p>
        <button type="button" className="button primary full" onClick={onApplyFieldConfig}>필드 설정 저장</button>
      </div>

      <div id="settings-panel-participation" role="tabpanel" aria-labelledby="settings-tab-participation" className={tabStyles.tabPanel} hidden={activeTab !== "participation"}>
        <fieldset className="settings-checks">
          <legend>참여 기능</legend>
          <label><input type="checkbox" checked={participationDraft.allowMemberPosting} onChange={(event) => patchParticipation({ allowMemberPosting: event.target.checked })} /><span>멤버 게시물 작성<small>멤버가 새 글을 올릴 수 있어요.</small></span></label>
          <label><input type="checkbox" checked={participationDraft.allowMemberFileUpload} onChange={(event) => patchParticipation({ allowMemberFileUpload: event.target.checked })} /><span>멤버 파일 업로드<small>이미지와 문서를 첨부할 수 있어요.</small></span></label>
          <label><input type="checkbox" checked={participationDraft.allowComments} onChange={(event) => patchParticipation({ allowComments: event.target.checked })} /><span>댓글 허용</span></label>
          <label><input type="checkbox" checked={participationDraft.allowReactions} onChange={(event) => patchParticipation({ allowReactions: event.target.checked })} /><span>반응 허용</span></label>
        </fieldset>
        <fieldset className={settingsStyles.group}>
          <legend>사용자당 반응 방식</legend>
          <OptionPicker
            name="reactionPolicyPicker"
            value={reactionPolicyDraft}
            onChange={onReactionPolicyChange}
            options={[
              { value: "SINGLE", label: "한 게시물에 하나", description: "게시물마다 반응을 하나만 남길 수 있어요." },
              { value: "MULTIPLE", label: "여러 반응 허용", description: "같은 게시물에 여러 종류의 반응을 함께 남길 수 있어요." },
            ]}
          />
        </fieldset>
        <AttachmentPolicyForm value={downloadPolicyDraft} onChange={onDownloadPolicyChange} />
      </div>

      <div id="settings-panel-moderation" role="tabpanel" aria-labelledby="settings-tab-moderation" className={tabStyles.tabPanel} hidden={activeTab !== "moderation"}>
        <fieldset className={settingsStyles.group}>
          <legend>게시물 승인</legend>
          <OptionPicker
            name="moderationMode"
            value={moderationModeDraft}
            onChange={onModerationModeChange}
            options={[
              { value: "NONE", label: "승인 없이 바로 게시", description: "누구나 쓰면 바로 보드에 올라가요." },
              { value: "MANUAL", label: "모든 게시물 승인 필요", description: "관리자가 승인해야 다른 사람에게 보여요." },
              { value: "STUDENTS_ONLY", label: "학생(멤버)만 승인 필요", description: "학생이 아닌 작성자는 바로 게시되고, 학생 글만 승인을 거쳐요." },
            ]}
          />
        </fieldset>
        <fieldset className={settingsStyles.group}>
          <legend>패드 동결</legend>
          <div className={settingsStyles.statusRow}>
            <span><Snowflake size={14} />{frozen ? "현재 동결됨" : "현재 활성 상태"}<small>동결 중에는 새 글·댓글·이동이 모두 막혀요.</small></span>
            <button type="button" className="button soft" onClick={onToggleFreeze}>{frozen ? "동결 해제" : "지금 동결"}</button>
          </div>
          <label className={settingsStyles.field}>
            <span>예약 동결 시각</span>
            <input type="datetime-local" value={freezeAtDraft} onChange={(event) => onFreezeAtChange(event.target.value)} />
          </label>
          <p className={settingsStyles.note}>지정 시각이 지나면 자동으로 동결돼요. 비워두면 예약이 해제돼요.</p>
        </fieldset>
      </div>

      <div id="settings-panel-members" role="tabpanel" aria-labelledby="settings-tab-members" className={tabStyles.tabPanel} hidden={activeTab !== "members"}>
        <PadAccessRequests boardId={board.id} onResolved={() => { void loadMembers(); }} />
        <div className="members-settings">
          <header><span><Users size={16} /><b>참여 멤버</b>{loadingMembers && <LoaderCircle size={14} className="spin" />}</span></header>
          <div>
            {members.map((member) => (
              <article key={member.user.id}>
                <Avatar name={member.user.name} identifier={member.user.loginIdentifier} image={member.user.image} />
                <span>{member.user.name || "이름 없음"}<small>{member.user.loginIdentifier || "로그인 정보 비공개"}</small></span>
                <select value={member.role} disabled={member.role === "OWNER"} onChange={async (event) => { await onChangeMemberRole(member.user.id, event.target.value); await loadMembers(); }}>
                  <option value="OWNER">소유자</option>
                  <option value="ADMIN">패드 관리자</option>
                  <option value="EDITOR">편집자</option>
                  <option value="MEMBER">멤버</option>
                  <option value="VIEWER">읽기 전용</option>
                </select>
                {member.role !== "OWNER" && <button type="button" className="member-remove" onClick={async () => { await onRemoveMember(member.user.id); await loadMembers(); }} aria-label="멤버 제거">×</button>}
              </article>
            ))}
          </div>
          {members.length < memberTotalCount && <button type="button" className="button ghost full" disabled={loadingMembers} onClick={() => loadMembers(memberPage + 1, true)}>{loadingMembers ? "불러오는 중…" : `멤버 더 보기 (${members.length}/${memberTotalCount})`}</button>}
        </div>
        <fieldset className={settingsStyles.group}>
          <legend>멤버 추가</legend>
          <MemberInvitePicker boardId={board.id} onInvited={loadMembers} />
          {showGroupInvite ? (
            <MemberGroupInvite boardId={board.id} onInvited={loadMembers} />
          ) : (
            <button type="button" className="button ghost small" onClick={() => setShowGroupInvite(true)}>학급·부서 통째로 추가할래요</button>
          )}
          {showEmailInvite ? (
            <button type="button" className="button soft" onClick={async () => { await onInviteMember(); await loadMembers(); }}>아이디·카카오 이메일로 추가</button>
          ) : (
            <button type="button" className="button ghost small" onClick={() => setShowEmailInvite(true)}>다른 학교 사람을 직접 추가할래요</button>
          )}
        </fieldset>
      </div>
      </div>
    </div>
  );
}
