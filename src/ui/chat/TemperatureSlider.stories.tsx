import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { TemperatureSlider } from './TemperatureSlider';
import { mockSetIcon } from './__stories__/mocks/sources';

const meta: Meta<typeof TemperatureSlider> = {
  title: 'Chat/TemperatureSlider',
  component: TemperatureSlider,
  args: {
    value: 0.7,
    onChange: fn(),
    onCommit: fn(),
    setIcon: mockSetIcon,
  },
};
export default meta;

type Story = StoryObj<typeof TemperatureSlider>;

export const Default: Story = {};

export const Min: Story = { args: { value: 0 } };

export const Max: Story = { args: { value: 2 } };

export const Disabled: Story = { args: { disabled: true } };

export const Interactive: Story = {
  render: (args) => {
    function Wrapper(): JSX.Element {
      const [v, setV] = useState<number>(args.value);
      return (
        <TemperatureSlider
          {...args}
          value={v}
          onChange={(next) => {
            setV(next);
            args.onChange(next);
          }}
          onCommit={(next) => {
            args.onCommit?.(next);
          }}
        />
      );
    }
    return <Wrapper />;
  },
};
