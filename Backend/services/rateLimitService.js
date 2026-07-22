function currentMonthRef() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function currentYearRef() {
  return String(new Date().getFullYear());
}

function checkAndBumpLimit(user, prefix, limits) {
  const mRef = currentMonthRef();
  const yRef = currentYearRef();

  let monthCount =
    user[`${prefix}_change_month_ref`] === mRef
      ? user[`${prefix}_change_count_month`]
      : 0;
  let yearCount =
    user[`${prefix}_change_year_ref`] === yRef
      ? user[`${prefix}_change_count_year`]
      : 0;

  if (monthCount >= limits.month) {
    return {
      allowed: false,
      reason: `Ei mase ${limits.month} bar limit shesh hoye geche.`,
    };
  }
  if (yearCount >= limits.year) {
    return {
      allowed: false,
      reason: `Ei bochor ${limits.year} bar limit shesh hoye geche.`,
    };
  }

  return {
    allowed: true,
    updates: {
      [`${prefix}_change_month_ref`]: mRef,
      [`${prefix}_change_count_month`]: monthCount + 1,
      [`${prefix}_change_year_ref`]: yRef,
      [`${prefix}_change_count_year`]: yearCount + 1,
    },
  };
}

module.exports = { checkAndBumpLimit };
