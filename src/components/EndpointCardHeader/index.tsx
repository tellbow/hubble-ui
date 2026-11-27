import classnames from 'classnames';
import React, { memo } from 'react';

import { ServiceCard } from '~/domain/service-map';

import { EndpointLogo } from './EndpointLogo';

import css from './styles.scss';
import { clickable } from '~/ui/a11y';

export interface Props {
  card: ServiceCard;
  currentNamespace?: string | null;
  onHeadlineClick?: () => void;
}

export const EndpointCardHeader = memo(function EndpointCardHeader(props: Props) {
  const { card, currentNamespace } = props;
  const showNamespace = !!card.namespace && card.namespace !== currentNamespace;
  const subtitle = showNamespace ? card.namespace : card.worldDetails;

  const titleClassName = classnames(css.title, {
    [css.single]: !subtitle,
  });

  return (
    <div className={css.wrapper}>
      <div className={css.headline} {...clickable(props.onHeadlineClick)}>
        <EndpointLogo card={card} />

        <div className={css.headings}>
          <div className={titleClassName}>{card.caption}</div>
          {subtitle && <div className={css.subtitle}>{subtitle}</div>}
        </div>
      </div>
    </div>
  );
});
