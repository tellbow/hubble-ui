import React, { memo } from 'react';
import classnames from 'classnames';

import css from './styles.scss';
import { clickable } from '~/ui/a11y';

export interface Props {
  icon?: React.JSX.Element | string;
  text?: string;
  className?: string;
  onClick?: () => void;
}

export const FilterIcon = memo<Props>(function FilterIcon(props) {
  const text = props.text;
  const icon = typeof props.icon === 'string' ? <img src={props.icon} alt="" /> : props.icon;

  const className = classnames(css.icon, props.className, {
    [css.clickable]: !!props.onClick,
  });

  return (
    <div className={className} {...clickable(props.onClick)}>
      {icon && <div className={css.image}>{icon}</div>}
      {text && <div className={css.text}>{text}</div>}
    </div>
  );
});
