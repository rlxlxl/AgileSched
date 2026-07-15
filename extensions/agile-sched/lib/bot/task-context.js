function getTaskAssigned(task) {
  if (!task || !task.assigned) return []
  return Array.isArray(task.assigned) ? task.assigned : [task.assigned]
}

function isSubtask(task) {
  return Boolean(task && task.parents && task.parents.length > 0)
}

function assignedChanged(task, prevTaskData) {
  const current = getTaskAssigned(task)
  const prev = getTaskAssigned(prevTaskData || {})
  if (current.length !== prev.length) return true
  return current.some(function (id, index) {
    return id !== prev[index]
  })
}

function formatLinkedProfileMessage(profile) {
  return (
    'Профиль ответственного: ' +
    profile.employee +
    '\n' +
    profile.department
  )
}

async function fetchTask(Api, taskId) {
  if (!taskId) return null
  try {
    return await Api.get('/tasks/' + taskId)
  } catch (error) {
    return null
  }
}

async function resolveSubtaskAssigneeProfile(deps, chatId) {
  const { Api, getUserProfile } = deps
  const task = await fetchTask(Api, chatId)
  if (!task || !isSubtask(task)) return null

  const assigned = getTaskAssigned(task)
  if (!assigned.length) return null

  for (let i = 0; i < assigned.length; i++) {
    const assigneeUserId = assigned[i]
    const profile = await getUserProfile(assigneeUserId)
    if (profile) {
      return {
        taskId: task.id,
        assigneeUserId: assigneeUserId,
        profile: profile
      }
    }
  }

  return null
}

module.exports = {
  getTaskAssigned,
  isSubtask,
  assignedChanged,
  formatLinkedProfileMessage,
  fetchTask,
  resolveSubtaskAssigneeProfile
}
