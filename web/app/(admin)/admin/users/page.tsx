"use client";

import { Fragment, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import {
  listUsers,
  listAccountProfiles,
  type AccountProfile,
  deleteUser,
  setUserRole,
  setMemberType,
  createUser,
  approveUser,
  rejectUser,
  type UserRecord,
} from "@/lib/admin-api";
import { AdminTabs } from "@/components/auth/AdminTabs";
import {
  Shield,
  ShieldOff,
  Trash2,
  RefreshCw,
  ArrowLeft,
  UserPlus,
  X,
  Check,
  Clock,
  Search,
  ChevronLeft,
  ChevronRight,
  Users,
  GraduationCap,
  BriefcaseBusiness,
} from "lucide-react";
import Link from "next/link";

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

type RoleFilter = "all" | "admin" | "teacher" | "student" | "unassigned";

const ROLE_FILTERS: ReadonlyArray<{ key: RoleFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "admin", label: "管理员" },
  { key: "teacher", label: "教师" },
  { key: "student", label: "学生" },
  { key: "unassigned", label: "待分配" },
];

export default function AdminUsersPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [identitySaving, setIdentitySaving] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createUsername, setCreateUsername] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [query, setQuery] = useState("");
  const [profiles, setProfiles] = useState<Record<string, AccountProfile>>({});
  const [profileError, setProfileError] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const tableScroll = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listUsers();
      setUsers(data);
      try { setProfiles(await listAccountProfiles()); setProfileError(false); }
      catch { setProfileError(true); }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to load users"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchAuthStatus().then((status) => {
      if (!status?.authenticated) {
        router.replace("/login");
        return;
      }
      if (status.role !== "admin") {
        router.replace("/");
        return;
      }
      setCurrentUser(status.username ?? null);
      setIsSuperAdmin(Boolean(status.is_super_admin));
      void load();
    });
  }, [router, load]);

  function openCreateDialog() {
    setCreateUsername("");
    setCreatePassword("");
    setCreateError("");
    setShowCreateDialog(true);
  }

  function closeCreateDialog() {
    if (createSubmitting) return;
    setShowCreateDialog(false);
  }

  async function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (createSubmitting) return;
    setCreateError("");
    const username = createUsername.trim();
    if (!username) {
      setCreateError(t("Username is required."));
      return;
    }
    if (createPassword.length < 8) {
      setCreateError(t("Password must be at least 8 characters."));
      return;
    }
    setCreateSubmitting(true);
    try {
      await createUser(username, createPassword);
      setShowCreateDialog(false);
      await load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : t("Failed to create user"));
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleDelete(username: string) {
    if (
      !window.confirm(t('Delete user "{{name}}"? This cannot be undone.', { name: username }))
    )
      return;
    setActionError("");
    try {
      await deleteUser(username);
      setUsers((prev) => prev.filter((u) => u.username !== username));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to delete user"));
    }
  }

  async function handleToggleRole(user: UserRecord) {
    const newRole = user.role === "admin" ? "user" : "admin";
    const verbLabel = newRole === "admin" ? t("Promote") : t("Demote");
    const roleLabel = t(newRole);
    if (
      !window.confirm(
        t('{{verb}} "{{name}}" to {{role}}?', {
          verb: verbLabel,
          name: user.username,
          role: roleLabel,
        }),
      )
    )
      return;
    setActionError("");
    try {
      await setUserRole(user.username, newRole);
      await load();

    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to update role"));
    }
  }

  async function handleApprove(username: string) {
    if (!window.confirm(t("Approve {{name}}?", { name: username }))) return;
    setActionError("");
    try {
      await approveUser(username);
      setUsers((prev) =>
        prev.map((u) =>
          u.username === username ? { ...u, status: "active" } : u,
        ),
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to save"));
    }
  }

  async function handleReject(username: string) {
    if (
      !window.confirm(
        t("Reject {{name}}? This will permanently delete their account.", {
          name: username,
        }),
      )
    )
      return;
    setActionError("");
    try {
      await rejectUser(username);
      setUsers((prev) => prev.filter((u) => u.username !== username));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to save"));
    }
  }

  async function handleMemberType(user: UserRecord, memberType: "student" | "teacher") {
    setActionError(""); setIdentitySaving(user.id);
    try {
      await setMemberType(user.username, memberType);
      setUsers((previous) => previous.map((item) => item.id === user.id ? { ...item, member_type: memberType } : item));
    } catch (error) { setActionError(error instanceof Error ? error.message : "身份修改失败"); }
    finally { setIdentitySaving(null); }
  }

  const roleCounts = useMemo<Record<RoleFilter, number>>(() => ({
    all: users.length,
    admin: users.filter((u) => u.role === "admin").length,
    teacher: users.filter((u) => u.role === "user" && u.member_type === "teacher").length,
    student: users.filter((u) => u.role === "user" && u.member_type === "student").length,
    unassigned: users.filter((u) => u.role === "user" && !u.member_type).length,
  }), [users]);

  const filteredUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return users.filter((u) => {
      const roleMatch =
        roleFilter === "all"
          ? true
          : roleFilter === "admin"
            ? u.role === "admin"
            : roleFilter === "unassigned" ? u.role === "user" && !u.member_type
            : u.role === "user" && u.member_type === roleFilter;
      const profile = profiles[u.id];
      const keywordMatch = !keyword || [u.username, profile?.name, profile?.code, profile?.class_name].some(value => value?.toLowerCase().includes(keyword));
      const state = u.disabled ? "disabled" : u.status === "pending" ? "pending" : "active";
      return roleMatch && keywordMatch && (statusFilter === "all" || statusFilter === state);
    });
  }, [users, roleFilter, query, profiles, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => setPage(1), [roleFilter, query, statusFilter, pageSize]);
  useEffect(() => { tableScroll.current?.scrollTo({ top: 0 }); }, [currentPage, roleFilter, query, pageSize, statusFilter]);

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] px-4 py-6 sm:px-8 sm:py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-7 flex flex-wrap items-center gap-3 sm:gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <ArrowLeft size={15} />
            {t("Back")}
          </Link>
          <div className="min-w-0 flex-1 basis-[calc(100%-64px)] sm:basis-0">
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
              {t("User Management")}
            </h1>
            <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
              统一管理账号、校园身份与画像档案
            </p>
          </div>
          <button
            onClick={openCreateDialog}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                       bg-[var(--primary)] text-[var(--primary-foreground)]
                       hover:opacity-90 transition-colors"
          >
            <UserPlus size={14} />
            {t("Add user")}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                       border border-[var(--border)] text-[var(--muted-foreground)]
                       hover:text-[var(--foreground)] hover:bg-[var(--card)]
                       disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {t("Refresh")}
          </button>
        </div>

        <AdminTabs className="mb-5" />

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            {key:"all", label:"全部账号", icon:Users},
            {key:"admin", label:"管理团队", icon:Shield},
            {key:"student", label:"学生账号", icon:GraduationCap},
            {key:"teacher", label:"教师账号", icon:BriefcaseBusiness},
          ] as const).map(({key,label,icon:Icon})=><button key={key} onClick={()=>setRoleFilter(key)} aria-pressed={roleFilter===key}
            className={`flex items-center justify-between rounded-xl border bg-[var(--card)] p-4 text-left transition-colors ${roleFilter===key?"border-[var(--primary)]":"border-[var(--border)] hover:border-[var(--ring)]"}`}>
            <span><span className="text-xs text-[var(--muted-foreground)]">{label}</span><span className="mt-2 block text-2xl font-semibold tabular-nums text-[var(--foreground)]">{loading?"—":roleCounts[key]}</span></span>
            <Icon size={23} strokeWidth={1.5} className="text-[var(--primary)]"/>
          </button>)}
        </div>
        {profileError&&<p role="status" className="mb-4 text-sm text-[var(--muted-foreground)]">画像档案暂未加载，可点击刷新重试；账号管理仍可使用。</p>}

        {actionError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {actionError}
          </div>
        )}

        {/* 角色导航 + 用户名搜索 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {ROLE_FILTERS.map((f) => {
              const active = roleFilter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setRoleFilter(f.key)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {f.label}
                  <span
                    className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] leading-none ${
                      active
                        ? "bg-black/15 dark:bg-white/25"
                        : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                    }`}
                  >
                    {roleCounts[f.key]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <select aria-label="账号状态筛选" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs text-[var(--foreground)]">
            <option value="all">全部状态</option><option value="active">已启用</option><option value="pending">待审核</option><option value="disabled">已停用</option>
          </select>
          <div className="relative min-w-0 flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="用户名、姓名、学号或班级"
              aria-label="搜索用户或档案"
              autoComplete="off"
              className="h-9 w-full min-w-48 rounded-lg border border-[var(--border)] bg-[var(--card)] py-1.5 pl-9 pr-8 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--ring)] sm:w-64"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="清除搜索"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                <X size={14} />
              </button>
            )}
          </div>
          </div>
        </div>

        <p className="mb-3 text-xs text-[var(--muted-foreground)]">{isSuperAdmin?"你是最高管理员，可任命管理员并管理全部账号。":"管理员可管理普通成员，管理员任命由最高管理员负责。"} <span className="sm:hidden">表格可左右滑动。</span></p>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[var(--muted-foreground)] text-sm">
              {t("Loading…")}
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16 text-red-500 text-sm">
              {error}
            </div>
          ) : users.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-[var(--muted-foreground)] text-sm">
              {t("No users found.")}
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-[var(--muted-foreground)] text-sm">
              没有符合条件的用户
            </div>
          ) : (
            <div ref={tableScroll} className="max-h-[min(62vh,680px)] overflow-auto"><table className="w-full min-w-[780px] text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--background)]">
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)] uppercase tracking-wider">
                  <th className="px-5 py-3 font-medium">{t("Username")}</th>
                  <th className="px-5 py-3 font-medium">{t("Role")}</th>
                  <th className="px-5 py-3 font-medium">身份</th>
                  <th className="px-5 py-3 font-medium">状态</th>
                  <th className="px-5 py-3 font-medium">{t("Joined")}</th>
                  <th className="px-5 py-3 font-medium text-right">{t("Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {pageUsers.map((user) => {
                  const isSelf = user.username === currentUser;
                  const isAdmin = user.role === "admin";
                  const isPending = user.status === "pending";
                  const canManage = !user.is_super_admin && (!isAdmin || isSuperAdmin);
                  const linked = profiles[user.id];
                  const profile = !isAdmin && linked?.kind === user.member_type ? linked : null;
                  return (
                    <Fragment key={user.username}>
                      <tr className={`group hover:bg-[var(--muted)] transition-colors ${isPending ? "bg-yellow-500/5" : ""}`}>
                        <td className="px-5 py-4 font-medium text-[var(--foreground)]">
                          <div className="flex items-center gap-3"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--muted)] text-xs font-semibold uppercase text-[var(--primary)]">{user.username.slice(0,2)}</span><div>
                          <div className="whitespace-nowrap">{user.username}
                          {isSelf && (
                            <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                              ({t("you")})
                            </span>
                          )}
                          </div><div className="mt-1 text-xs font-normal text-[var(--muted-foreground)]">{isAdmin?"全校范围 · 无需校园身份":profile?`${profile.name} · ${profile.code}`:linked?"身份已变更，需重新关联档案":"暂未关联画像档案"}</div>
                          {profile?.class_name&&<div className="mt-1 text-xs font-normal text-[var(--muted-foreground)]">{profile.class_name}</div>}
                          </div></div>
                        </td>
                        <td className="px-5 py-3.5">
                          {isPending ? (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium bg-yellow-500/15 text-yellow-600 dark:text-yellow-400">
                              <Clock size={11} />
                              {t("Pending")}
                            </span>
                          ) : (
                            <span
                              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium
                              ${
                                user.is_super_admin ? "account-badge-warning" : user.role === "admin"
                                  ? "account-badge-admin"
                                  : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                              }`}
                            >
                              {user.role === "admin" ? (
                                <Shield size={11} />
                              ) : null}
                              {user.is_super_admin ? "最高管理员" : t(user.role)}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          {isAdmin ? <span className="text-xs text-[var(--muted-foreground)]">全部权限</span> : (
                          <select aria-label={user.username + "的身份"} value={user.member_type ?? ""}
                            disabled={(!canManage && !isSelf) || identitySaving === user.id}
                            onChange={(event) => void handleMemberType(user, event.target.value as "student" | "teacher")}
                            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--foreground)] disabled:opacity-60">
                            <option value="" disabled>待分配</option><option value="student">学生</option><option value="teacher">教师</option>
                          </select>
                          )}
                        </td>
                        <td className="px-5 py-3.5"><span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${isPending?"text-[var(--badge-warning)]":"text-[var(--muted-foreground)]"}`}><span className={`h-1.5 w-1.5 rounded-full ${user.disabled?"bg-[var(--destructive)]":isPending?"bg-[var(--badge-warning)]":"bg-[var(--chart-2)]"}`}/>{user.disabled?"已停用":isPending?"待审核":"已启用"}</span></td>
                        <td className="px-5 py-3.5 text-[var(--muted-foreground)]">
                          {formatDate(user.created_at)}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {isPending ? (
                              <>
                                <button
                                  onClick={() => handleApprove(user.username)}
                                  title={t("Approve")}
                                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium
                                           bg-green-500/10 text-green-600 dark:text-green-400
                                           hover:bg-green-500/20 transition-colors"
                                >
                                  <Check size={13} />
                                  {t("Approve")}
                                </button>
                                <button
                                  onClick={() => handleReject(user.username)}
                                  title={t("Reject")}
                                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium
                                           bg-red-500/10 text-red-500
                                           hover:bg-red-500/20 transition-colors"
                                >
                                  <X size={13} />
                                  {t("Reject")}
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleToggleRole(user)}
                                  disabled={isSelf || !isSuperAdmin || !!user.is_super_admin}
                                  title={
                                    !isSuperAdmin
                                      ? "仅最高管理员可以任命或撤销管理员"
                                      : user.is_super_admin
                                      ? "不能修改最高管理员"
                                      : isSelf
                                      ? t("Cannot change your own role")
                                      : user.role === "admin"
                                        ? t("Demote to user")
                                        : t("Promote to admin")
                                  }
                                  className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                           hover:bg-[var(--background)] hover:text-[var(--foreground)]
                                           disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                >
                                  {user.role === "admin" ? (
                                    <ShieldOff size={15} />
                                  ) : (
                                    <Shield size={15} />
                                  )}
                                </button>
                                <button
                                  onClick={() => handleDelete(user.username)}
                                  disabled={isSelf || !canManage}
                                  title={
                                    !canManage && !isSelf
                                      ? "无权删除该管理员账号"
                                      : isSelf
                                      ? t("Cannot delete your own account")
                                      : t("Delete {{name}}", { name: user.username })
                                  }
                                  className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                           hover:bg-red-500/10 hover:text-red-500
                                           disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>

                    </Fragment>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </div>

        {!loading&&!error&&<div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted-foreground)]">
          <span role="status">共 {filteredUsers.length} 个账号{filteredUsers.length>0?`，显示 ${(currentPage-1)*pageSize+1}–${Math.min(currentPage*pageSize,filteredUsers.length)}`:""}</span>
          <div className="flex items-center gap-3"><label className="flex items-center gap-2">每页<select aria-label="每页账号数" value={pageSize} onChange={e=>setPageSize(Number(e.target.value))} className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[var(--foreground)]">{[10,20,50].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
            <button aria-label="上一页" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)} className="rounded-md border border-[var(--border)] p-1.5 disabled:opacity-30"><ChevronLeft size={14}/></button><span>{currentPage} / {pageCount}</span><button aria-label="下一页" disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)} className="rounded-md border border-[var(--border)] p-1.5 disabled:opacity-30"><ChevronRight size={14}/></button>
          </div>
        </div>}

        <p className="mt-8 text-center text-xs text-[var(--muted-foreground)]">
          {t("DeepTutor Admin · User Management")}
        </p>
      </div>

      {showCreateDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          onClick={closeCreateDialog}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateSubmit}
            className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--foreground)]">
                {t("Add user")}
              </h2>
              <button
                type="button"
                onClick={closeCreateDialog}
                disabled={createSubmitting}
                className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-40"
                aria-label={t("Close")}
              >
                <X size={16} />
              </button>
            </div>

            <label className="mb-3 block text-xs text-[var(--muted-foreground)]">
              {t("Username (or email)")}
              <input
                type="text"
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value)}
                disabled={createSubmitting}
                autoComplete="off"
                autoFocus
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
              />
            </label>

            <label className="mb-4 block text-xs text-[var(--muted-foreground)]">
              {t("Password (≥ 8 chars)")}
              <input
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                disabled={createSubmitting}
                autoComplete="new-password"
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
              />
            </label>

            {createError && (
              <p className="mb-3 text-xs text-red-500">{createError}</p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeCreateDialog}
                disabled={createSubmitting}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                disabled={createSubmitting}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-40"
              >
                {createSubmitting ? t("Creating…") : t("Create")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
