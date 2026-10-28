// How many date pickers are open right now. A Sheet reads this so Escape closes the picker first and the sheet only on the next press.
let open = 0;
export const datePickerOpened = () => {
  open += 1;
};
export const datePickerClosed = () => {
  open -= 1;
};
export const datePickerIsOpen = () => open > 0;
